/**
 * One command turns a studio delivery into a publishable series (CP-1).
 *
 *   node scripts/ingest-series.mjs [slug …] [--force]
 *
 * Input — everything the producer sends, under `content/series/<slug>/`:
 *
 *   series.json          rights, producer of record, episode list, copy
 *   masters/             one vertical master per episode
 *   captions/            one .vtt or .srt per episode and language
 *
 * Output — nothing typed by hand:
 *
 *   apps/web/public/content/series/<slug>/hls/episode-N/    adaptive renditions
 *   apps/web/public/content/series/<slug>/posters/          feed poster (WebP)
 *   apps/web/public/content/series/<slug>/share/            1200×630 link card
 *   apps/web/public/content/series/<slug>/captions/         verified WebVTT
 *   packages/feed-domain/src/data/generated/<slug>.ts       the series manifest
 *
 * Three properties this script must keep, because a launch depends on them:
 *
 *   - a refused delivery changes NOTHING that is published. Every episode is
 *     packaged, and every poster, card and caption written, in a stage folder
 *     (`.ingest-stage/<slug>/`, on the same disk). Only when the whole series
 *     passes does the stage replace the published folder, in one rename, and
 *     only then is the manifest written. A refusal or a crash leaves the
 *     published series byte for byte as it was;
 *   - idempotent and resumable: an episode whose master, gate version and gate
 *     options (audio stream, length range, resolution exception) have not
 *     changed is not re-encoded. Renditions that passed stay in the stage
 *     after a refusal or an interruption, so a run stopped at episode 40 of
 *     80 costs the remaining 40 and nothing else;
 *   - every number in the manifest is measured (ffmpeg, the parsed cues, the
 *     files on disk), never declared by the delivery.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  captionNotes,
  captionSummary,
  checkCaptionTrack,
  parseVttCues,
  srtToVtt,
} from "./lib/vtt.mjs";
import { checkDuplicateSource, formatIssues } from "./lib/media-gate.mjs";
import {
  checkCaptionLicence,
  checkEpisodeNumbers,
  checkEpisodeSlugs,
  checkRights,
  episodeSlugOf,
  gateOptionsFor,
  isInside,
  isPackageCurrent,
  isSlug,
  packageFlags,
} from "./lib/delivery-rules.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * The roots are overridable so a proof run (scripts/gate-proof.mjs) can drive
 * the real ingest on deliberately broken deliveries without touching the
 * repository's content, published assets or generated manifests.
 */
function rootFlag(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  if (value === undefined) {
    console.error(`ingest-series: ${name} needs a directory`);
    process.exit(1);
  }
  return resolve(value);
}

const deliveryRoot = rootFlag("--delivery-root", join(repoRoot, "content", "series"));
const publishRoot = rootFlag(
  "--publish-root",
  join(repoRoot, "apps", "web", "public", "content", "series"),
);
const generatedRoot = rootFlag(
  "--generated-root",
  join(repoRoot, "packages", "feed-domain", "src", "data", "generated"),
);
/**
 * Where a series is assembled before it replaces the published one. It must
 * sit on the same disk as the publish root (a rename cannot cross disks) and
 * outside anything the site build copies.
 */
const stageRoot = rootFlag(
  "--stage-root",
  process.argv.includes("--publish-root")
    ? join(dirname(publishRoot), ".ingest-stage")
    : join(repoRoot, ".ingest-stage"),
);
const SERIES_MANIFEST_VERSION = 2;
/** Poster width in the feed: the slide is at most 450 CSS px wide (speed-7). */
const POSTER_WIDTH = 540;
const SHARE_CARD_WIDTH = 1200;
const SHARE_CARD_HEIGHT = 630;
/** Must match scripts/package-episode.mjs: a rule change re-runs the pack. */
const GATE_VERSION = 3;

const ROOT_FLAGS = new Set(["--delivery-root", "--publish-root", "--generated-root", "--stage-root"]);
const args = process.argv.slice(2);
const force = args.includes("--force");
const requestedSlugs = args.filter(
  (arg, index) => !arg.startsWith("--") && !ROOT_FLAGS.has(args[index - 1] ?? ""),
);

function die(message) {
  console.error(`ingest-series: ${message}`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) die(`${command} could not start: ${result.error.message}`);
  return result;
}

function ffmpeg(commandArgs) {
  const result = run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...commandArgs]);
  if (result.status !== 0) {
    die(`ffmpeg exited with ${result.status}\n${(result.stderr ?? "").slice(-2000)}`);
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`${path} is not readable JSON: ${error.message}`);
    return null;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

/** A synchronous pause, for retrying a rename that Windows refused for a moment. */
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Rename, retried: on Windows an antivirus or an indexer can hold a file for a
 * moment. A rename that still fails throws, and the caller decides.
 */
function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const busy = ["EPERM", "EBUSY", "EACCES"].includes(error.code);
      if (!busy || attempt >= 6) throw error;
      pause(250 * attempt);
    }
  }
}

/**
 * An episode already published, copied into the stage as hard links: no
 * bytes are duplicated, and the published files are never opened for writing.
 */
function linkTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    const target = join(to, name);
    if (statSync(source).isDirectory()) {
      linkTree(source, target);
      continue;
    }
    try {
      linkSync(source, target);
    } catch {
      copyFileSync(source, target);
    }
  }
}

/** Relative path → absolute path, for every file under `dir`. */
function listFiles(dir, prefix = "", out = new Map()) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(path).isDirectory()) listFiles(path, rel, out);
    else out.set(rel, path);
  }
  return out;
}

function sameFile(a, b) {
  const sa = statSync(a, { bigint: true });
  const sb = statSync(b, { bigint: true });
  if (sa.ino !== 0n && sa.ino === sb.ino && sa.dev === sb.dev) return true;
  if (sa.size !== sb.size) return false;
  return readFileSync(a).equals(readFileSync(b));
}

/** Same files, same bytes: then nothing needs to be swapped. */
function sameTree(a, b) {
  const left = listFiles(a);
  const right = listFiles(b);
  if (left.size !== right.size) return false;
  for (const [rel, path] of left) {
    const other = right.get(rel);
    if (!other || !sameFile(path, other)) return false;
  }
  return true;
}

/** The packaging record of an episode folder, or null when it is not a finished package. */
function readRecord(dir) {
  const path = join(dir, "manifest.json");
  if (!existsSync(path) || !existsSync(join(dir, "master.m3u8"))) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** The delivery file, before anything is trusted about it — and before any path is built from it. */
function readDelivery(slug) {
  if (!isSlug(slug)) {
    die(`"${slug}" is not a series slug: lowercase letters and digits joined by single hyphens`);
  }
  const dir = join(deliveryRoot, slug);
  const file = join(dir, "series.json");
  if (!existsSync(file)) die(`${file} does not exist: nothing to ingest for "${slug}"`);
  const delivery = readJson(file);
  const problems = [];
  for (const field of ["seriesId", "seriesSlug", "title", "defaultLocale", "producerId", "producerOfRecord"]) {
    if (!isNonEmptyString(delivery[field])) problems.push(`${field} is required`);
  }
  if (delivery.seriesSlug !== slug) {
    problems.push(`seriesSlug "${delivery.seriesSlug}" does not match the folder "${slug}"`);
  }
  if (typeof delivery.socialClipsAllowed !== "boolean") {
    problems.push("socialClipsAllowed must be declared true or false (CP-6)");
  }
  const rights = delivery.rights ?? {};
  if (!isStringArray(rights.territories)) problems.push("rights.territories is required (F8)");
  if (!isStringArray(rights.languages)) problems.push("rights.languages is required (F8)");
  for (const key of ["windowStart", "windowEnd"]) {
    const value = rights[key] ?? null;
    if (value !== null && !Number.isFinite(Date.parse(value))) {
      problems.push(`rights.${key} is not an ISO date: ${String(value)}`);
    }
  }
  problems.push(...checkRights(delivery));
  if (!Array.isArray(delivery.episodes) || delivery.episodes.length === 0) {
    problems.push("episodes must list at least one episode");
  } else {
    // Numbers first: a numbering typo is usually also why two slugs collide.
    for (const listIssue of [
      ...checkEpisodeNumbers(delivery.episodes),
      ...checkEpisodeSlugs(delivery.episodes),
    ]) {
      problems.push(`[${listIssue.code}] ${listIssue.message}`);
    }
  }
  if (problems.length > 0) {
    console.error(`ingest-series: REFUSED ${slug} — the delivery file is incomplete`);
    for (const problem of problems) console.error(`    - ${problem}`);
    console.error("  Nothing was published or changed. Fix series.json and run again.");
    process.exit(1);
  }
  return { dir, delivery };
}

/** Feed poster (WebP, at the size it is shown) and the landscape link card. */
function renderImages(master, seconds, posterPath, sharePath) {
  const at = String(Math.min(1, seconds / 2));
  mkdirSync(dirname(posterPath), { recursive: true });
  mkdirSync(dirname(sharePath), { recursive: true });
  ffmpeg([
    "-ss",
    at,
    "-i",
    master,
    "-frames:v",
    "1",
    "-vf",
    `scale=${POSTER_WIDTH}:-2:flags=lanczos`,
    "-c:v",
    "libwebp",
    "-quality",
    "72",
    "-compression_level",
    "6",
    posterPath,
  ]);
  // VIR-4: crawlers crop a wide card to about 1.91:1, so the portrait frame
  // sits whole on a blurred fill of itself instead of being cut to a band.
  ffmpeg([
    "-ss",
    at,
    "-i",
    master,
    "-frames:v",
    "1",
    "-filter_complex",
    [
      "[0:v]split=2[bg][fg]",
      `[bg]scale=${SHARE_CARD_WIDTH}:${SHARE_CARD_HEIGHT}:force_original_aspect_ratio=increase,` +
        `crop=${SHARE_CARD_WIDTH}:${SHARE_CARD_HEIGHT},gblur=sigma=28,eq=brightness=-0.10[bgb]`,
      `[fg]scale=-2:${SHARE_CARD_HEIGHT}:flags=lanczos[fgs]`,
      "[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1",
    ].join(";"),
    "-q:v",
    "4",
    sharePath,
  ]);
}

/**
 * A crash between the two renames of a swap leaves the old series in the
 * stage as `<slug>.previous` and nothing published. Put it back first.
 */
function recoverInterruptedSwap(slug, publishDir) {
  const previous = join(stageRoot, `${slug}.previous`);
  if (!existsSync(previous)) return;
  if (!existsSync(publishDir)) {
    renameWithRetry(previous, publishDir);
    console.error(`ingest-series: ${slug} — restored the published series left by an interrupted run`);
  } else {
    rmSync(previous, { recursive: true, force: true });
  }
}

/**
 * The staged series replaces the published one. Two renames: the published
 * folder steps aside, the stage takes its place. If the second fails, the
 * first is undone, so the site never points at a half-built folder.
 */
function swapIntoPlace(slug, stageDir, publishDir) {
  const previous = join(stageRoot, `${slug}.previous`);
  rmSync(previous, { recursive: true, force: true });
  mkdirSync(dirname(publishDir), { recursive: true });
  if (existsSync(publishDir)) {
    try {
      renameWithRetry(publishDir, previous);
    } catch (error) {
      die(
        `could not move the published ${slug} aside (${error.code ?? error.message}); nothing was changed. ` +
          `Close whatever holds files under ${publishDir} and run again.`,
      );
    }
  }
  try {
    renameWithRetry(stageDir, publishDir);
  } catch (error) {
    if (existsSync(previous)) renameWithRetry(previous, publishDir);
    die(
      `could not move the new ${slug} into place (${error.code ?? error.message}); the published series was put back unchanged`,
    );
  }
  try {
    rmSync(previous, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    // The swap is done; the old copy is only clutter, removed by the next run.
    console.error(`ingest-series: ${slug} — the previous version stays in ${previous} for now (${error.code ?? error.message})`);
  }
}

function ingestSeries(slug) {
  const { dir, delivery } = readDelivery(slug);
  const publishDir = join(publishRoot, slug);
  const stageDir = join(stageRoot, slug);
  const stageHls = join(stageDir, "hls");
  if (!isInside(publishRoot, publishDir) || !isInside(stageRoot, stageDir)) {
    die(`"${slug}" resolves outside the publish or stage folder`);
  }
  recoverInterruptedSwap(slug, publishDir);

  // Images and captions are rebuilt every run. Staged renditions stay: they
  // are the resume point of a run that was refused or interrupted.
  for (const part of ["posters", "share", "captions"]) {
    rmSync(join(stageDir, part), { recursive: true, force: true });
  }
  mkdirSync(stageHls, { recursive: true });

  const failures = [];
  const notes = [];
  const packagedNow = [];
  const resumed = [];
  const skipped = [];
  const seenSources = new Map();
  /** Staged episode folders that hold a package the gate accepted. */
  const validStaged = new Set();

  // Numbers and slugs were checked by readDelivery: 1..N, safe, unique.
  const episodes = [...delivery.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);

  const manifestEpisodes = [];

  for (const episode of episodes) {
    const number = episode.episodeNumber;
    const label = `${slug} episode ${number}`;
    const episodeSlug = episodeSlugOf(episode);
    const issues = [];

    const masterPath = resolve(dir, episode.master ?? "");
    if (!isNonEmptyString(episode.master) || !existsSync(masterPath)) {
      failures.push({
        label,
        issues: [{ code: "missing_master", message: `no master at ${episode.master ?? "(not declared)"}` }],
      });
      continue;
    }
    const sourceSha256 = sha256(masterPath);
    issues.push(...checkDuplicateSource(sourceSha256, seenSources));
    seenSources.set(sourceSha256, label);
    if (issues.length > 0) {
      failures.push({ label, issues });
      continue;
    }

    const liveEpisode = join(publishDir, "hls", episodeSlug);
    const stagedEpisode = join(stageHls, episodeSlug);
    if (!isInside(stageHls, stagedEpisode)) die(`${label}: "${episodeSlug}" leaves the stage folder`);
    const gateOptions = gateOptionsFor(delivery, episode);
    const expected = { sourceSha256, gateVersion: GATE_VERSION, gateOptions };

    let packaged = null;
    const staged = force ? null : readRecord(stagedEpisode);
    const live = force ? null : readRecord(liveEpisode);
    if (isPackageCurrent(staged, expected)) {
      packaged = staged;
      resumed.push(label);
    } else if (isPackageCurrent(live, expected)) {
      rmSync(stagedEpisode, { recursive: true, force: true });
      linkTree(liveEpisode, stagedEpisode);
      packaged = live;
      skipped.push(label);
    } else {
      rmSync(stagedEpisode, { recursive: true, force: true });
      const result = run(
        process.execPath,
        [
          join(repoRoot, "scripts", "package-episode.mjs"),
          masterPath,
          stagedEpisode,
          "--no-poster",
          "--label",
          label,
          ...packageFlags(gateOptions),
        ],
        { stdio: "inherit" },
      );
      if (result.status !== 0) {
        // package-episode already printed the reasons, named by label. What it
        // left behind is a half-written stage folder, never a published one.
        rmSync(stagedEpisode, { recursive: true, force: true });
        failures.push({
          label,
          issues: [{ code: "gate_refused", message: "the technical quality gate refused it (reasons above)" }],
        });
        continue;
      }
      packaged = readJson(join(stagedEpisode, "manifest.json"));
      packagedNow.push(label);
    }
    validStaged.add(episodeSlug);

    const durationMs = packaged.durationMs;

    // Poster and share card come from the master every run: they are cheap,
    // and a poster that silently belongs to an older cut is worse than a wait.
    const posterName = `${episodeSlug}.webp`;
    const shareName = `${episodeSlug}.jpg`;
    renderImages(
      masterPath,
      durationMs / 1000,
      join(stageDir, "posters", posterName),
      join(stageDir, "share", shareName),
    );

    const captions = [];
    const declared = Array.isArray(episode.captions) ? episode.captions : [];
    if (declared.length === 0) {
      issues.push({
        code: "no_captions",
        message: "no caption file declared: most of the feed is watched muted",
      });
    }
    for (const track of declared) {
      const language = track.language;
      const sourcePath = resolve(dir, track.file ?? "");
      const trackLabel = `${episodeSlug} [${String(language)}]`;
      if (!isNonEmptyString(track.file) || !existsSync(sourcePath)) {
        issues.push({
          code: "missing_caption_file",
          message: `${trackLabel}: no file at ${track.file ?? "(not declared)"}`,
        });
        continue;
      }
      const raw = readFileSync(sourcePath, "utf8");
      const vtt = sourcePath.toLowerCase().endsWith(".srt") ? srtToVtt(raw) : raw;
      const parsed = parseVttCues(vtt);
      const trackIssues = [
        ...checkCaptionTrack(parsed, {
          durationMs,
          language,
          hasAudio: packaged.hasAudio === true,
        }),
        ...checkCaptionLicence(language, delivery.rights),
      ];
      if (trackIssues.length > 0) {
        for (const trackIssue of trackIssues) {
          issues.push({ code: trackIssue.code, message: `${trackLabel}: ${trackIssue.message}` });
        }
        continue;
      }
      for (const note of captionNotes(parsed, durationMs)) {
        notes.push(`${label} ${trackLabel}: [${note.code}] ${note.message}`);
      }
      const outName = `${episodeSlug}.${language}.vtt`;
      const outPath = join(stageDir, "captions", outName);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, vtt);
      const summary = captionSummary(parsed, durationMs);
      captions.push({
        language,
        url: `/content/series/${slug}/captions/${outName}`,
        kind: track.kind === "subtitles" ? "subtitles" : "captions",
        default: track.default === true,
        // "ready" now means parsed, covering this episode, and on disk.
        status: "ready",
        cues: summary.cues,
        coverage: summary.coverage,
      });
    }
    if (captions.length > 0 && !captions.some((track) => track.default)) {
      captions[0].default = true;
    }

    if (issues.length > 0) {
      failures.push({ label, issues });
      continue;
    }

    manifestEpisodes.push({
      episodeNumber: number,
      episodeSlug,
      title: episode.title,
      hook: episode.hook,
      localizedMetadata: localizedFor(delivery, episode),
      durationMs,
      width: packaged.width,
      height: packaged.height,
      fps: packaged.fps,
      playbackReference: `/content/series/${slug}/hls/${episodeSlug}/master.m3u8`,
      posterReference: `/content/series/${slug}/posters/${posterName}`,
      shareCardReference: `/content/series/${slug}/share/${shareName}`,
      captions,
      sourceSha256,
      publishedLufs: packaged.loudness?.publishedLufs ?? null,
      genres: episode.genres ?? delivery.genres ?? [],
      tropes: episode.tropes ?? delivery.tropes ?? [],
    });
  }

  // Staged episode folders that are not a package the gate accepted in this
  // run — stale slugs, half-written encodes — never reach the published tree.
  for (const name of existsSync(stageHls) ? readdirSync(stageHls) : []) {
    if (!validStaged.has(name)) rmSync(join(stageHls, name), { recursive: true, force: true });
  }

  if (failures.length > 0) {
    // Nothing under the published folder was opened for writing. The stage
    // keeps only the renditions that passed, so the fixed delivery resumes.
    for (const part of ["posters", "share", "captions"]) {
      rmSync(join(stageDir, part), { recursive: true, force: true });
    }
    if (readdirSync(stageHls).length === 0) rmSync(stageDir, { recursive: true, force: true });
    console.error(`\ningest-series: REFUSED ${slug} — ${failures.length} episode(s) cannot be published`);
    for (const failure of failures) console.error(formatIssues(failure.label, failure.issues));
    console.error(
      "  Nothing published was changed: the catalog and its files keep the version that worked. Fix the delivery and run again.",
    );
    return { ok: false, slug };
  }

  const manifest = {
    schemaVersion: SERIES_MANIFEST_VERSION,
    seriesId: delivery.seriesId,
    seriesSlug: slug,
    title: delivery.title,
    status: delivery.status === "draft" ? "draft" : "published",
    defaultLocale: delivery.defaultLocale,
    localizedMetadata: delivery.localizedMetadata ?? {},
    producerId: delivery.producerId,
    producerOfRecord: delivery.producerOfRecord,
    socialClipsAllowed: delivery.socialClipsAllowed,
    rights: {
      territories: delivery.rights.territories,
      languages: delivery.rights.languages,
      windowStart: delivery.rights.windowStart ?? null,
      windowEnd: delivery.rights.windowEnd ?? null,
    },
    packagedAt: new Date().toISOString(),
    gateVersion: GATE_VERSION,
    episodes: manifestEpisodes,
  };

  // What disappears with the swap, named at the level a person reads it:
  // "hls/episode-6", "posters/episode-6.webp".
  const entries = (root) =>
    new Set([...listFiles(root).keys()].map((rel) => rel.split("/").slice(0, 2).join("/")));
  const after = entries(stageDir);
  const removed = [...entries(publishDir)].filter((entry) => !after.has(entry));
  let replaced = false;
  if (existsSync(publishDir) && sameTree(stageDir, publishDir)) {
    rmSync(stageDir, { recursive: true, force: true });
  } else {
    swapIntoPlace(slug, stageDir, publishDir);
    replaced = true;
  }

  const previous = previousManifest(slug);
  if (
    previous &&
    JSON.stringify({ ...previous, packagedAt: "" }) ===
      JSON.stringify({ ...manifest, packagedAt: "" })
  ) {
    manifest.packagedAt = previous.packagedAt;
  }
  writeManifestModule(slug, manifest);

  reportSeries(slug, manifest, {
    packagedNow,
    resumed,
    skipped,
    removed,
    replaced,
    notes,
    publishDir,
  });
  return { ok: true, slug, manifest };
}

/**
 * Episode copy per locale: the delivery's own translation when it sent one,
 * otherwise the base title and hook. Nothing is invented, and a locale the
 * series does not declare never appears.
 */
function localizedFor(delivery, episode) {
  const out = {};
  const locales = new Set([
    delivery.defaultLocale,
    ...Object.keys(delivery.localizedMetadata ?? {}),
    ...Object.keys(episode.translations ?? {}),
  ]);
  for (const locale of locales) {
    const translation = episode.translations?.[locale];
    const seriesCopy = delivery.localizedMetadata?.[locale];
    const entry = {
      title: translation?.title ?? episode.title,
      hook: translation?.hook ?? episode.hook,
    };
    const description = translation?.description ?? seriesCopy?.description;
    if (isNonEmptyString(description)) entry.description = description;
    out[locale] = entry;
  }
  return out;
}

/** slug → module name and exported constant, both deterministic. */
function constantName(slug) {
  return `${slug.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}_MANIFEST`;
}

/**
 * The manifest already generated for this series, or null. Read back so an
 * ingest that changes nothing writes nothing: a file that churns on every run
 * hides the runs that did change something.
 */
function previousManifest(slug) {
  const path = join(generatedRoot, `${slug}.ts`);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const start = text.indexOf("= {");
  const end = text.lastIndexOf("};");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start + 2, end + 1));
  } catch {
    return null;
  }
}

function writeManifestModule(slug, manifest) {
  mkdirSync(generatedRoot, { recursive: true });
  const body =
    `/**\n` +
    ` * GENERATED by scripts/ingest-series.mjs — do not edit by hand.\n` +
    ` *\n` +
    ` * Every number here was measured on the packaged episode: durations by\n` +
    ` * ffmpeg, caption coverage by the parsed cues, loudness read back from the\n` +
    ` * audio that will be served. Editing this file by hand puts the catalog and\n` +
    ` * the files on disk out of step, which is exactly what ingest exists to\n` +
    ` * prevent. Change content/series/${slug}/series.json and run ingest again.\n` +
    ` */\n` +
    `import type { SeriesManifest } from "../../content/seriesManifest";\n\n` +
    `export const ${constantName(slug)}: SeriesManifest = ${JSON.stringify(manifest, null, 2)};\n`;
  writeFileSync(join(generatedRoot, `${slug}.ts`), body);

  const slugs = readdirSync(generatedRoot)
    .filter((name) => name.endsWith(".ts") && name !== "index.ts")
    .map((name) => name.slice(0, -3))
    .sort();
  const index =
    `/**\n` +
    ` * GENERATED by scripts/ingest-series.mjs — do not edit by hand.\n` +
    ` *\n` +
    ` * The series the catalog is built from, in feed order.\n` +
    ` */\n` +
    `import type { SeriesManifest } from "../../content/seriesManifest";\n` +
    slugs.map((name) => `import { ${constantName(name)} } from "./${name}";\n`).join("") +
    `\nexport const SERIES_MANIFESTS: SeriesManifest[] = [\n` +
    slugs.map((name) => `  ${constantName(name)},\n`).join("") +
    `];\n`;
  writeFileSync(join(generatedRoot, "index.ts"), index);
}

function directoryBytes(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((sum, name) => {
    const path = join(dir, name);
    const stats = statSync(path);
    return sum + (stats.isDirectory() ? directoryBytes(path) : stats.size);
  }, 0);
}

/** The spread the gate cares about: lengths, loudness, caption coverage. */
function reportSeries(
  slug,
  manifest,
  { packagedNow, resumed, skipped, removed, replaced, notes, publishDir },
) {
  const durations = manifest.episodes.map((episode) => episode.durationMs / 1000);
  const loudness = manifest.episodes
    .map((episode) => episode.publishedLufs)
    .filter((value) => typeof value === "number");
  const coverage = manifest.episodes.flatMap((episode) =>
    episode.captions.map((track) => track.coverage),
  );
  const span = (values) =>
    values.length === 0
      ? "none"
      : `${Math.min(...values).toFixed(1)} … ${Math.max(...values).toFixed(1)}`;

  console.error(`\ningest-series: ${slug} ok — ${manifest.episodes.length} episodes`);
  console.error(
    `  packaged now: ${packagedNow.length}, resumed from the stage: ${resumed.length}, unchanged: ${skipped.length}`,
  );
  console.error(`  length (s):   ${span(durations)}`);
  console.error(`  loudness:     ${span(loudness)} LUFS (target ${-16})`);
  console.error(
    `  captions:     ${coverage.length} tracks, coverage ${span(coverage.map((value) => value * 100))} %`,
  );
  console.error(
    `  published:    ${Math.round(directoryBytes(publishDir) / 1024)} kB under ${basename(publishDir)} (${replaced ? "replaced in one swap" : "unchanged, byte for byte"})`,
  );
  if (removed.length > 0) console.error(`  removed stale: ${removed.join(", ")}`);
  if (notes.length > 0) {
    console.error("  worth a look (published anyway):");
    for (const note of notes) console.error(`    - ${note}`);
  }
}

const slugs =
  requestedSlugs.length > 0
    ? requestedSlugs
    : readdirSync(deliveryRoot).filter((name) =>
        existsSync(join(deliveryRoot, name, "series.json")),
      );
if (slugs.length === 0) die(`no series with a series.json under ${deliveryRoot}`);

let refused = 0;
for (const slug of slugs) {
  const result = ingestSeries(slug);
  if (!result.ok) refused += 1;
}
if (refused > 0) {
  console.error(`\ningest-series: ${refused} of ${slugs.length} series refused`);
  process.exit(1);
}
console.error(`\ningest-series: ${slugs.length} series ready`);
