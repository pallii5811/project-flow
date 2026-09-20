/**
 * One delivery → a published series, on a machine that is not the owner's
 * (docs/cloud-ingest.md). This is what the GitHub workflow runs.
 *
 *   node scripts/cloud-ingest.mjs <slug> --source <file-or-folder>
 *        [--budget-minutes 320] [--delivery-root content/series]
 *        [--generated-root <dir>] [--records-root <dir>] [--publish-root <dir>]
 *
 * It works episode by episode, and each episode is finished before the next
 * one starts: cut from the compilation (when the series has a confirmed
 * cuts.json), packaged, uploaded to the media store, recorded, and its local
 * files deleted. That is what keeps a 90-minute delivery inside a runner's
 * 14 GB of disk, and what lets a series that needs more than one job be
 * published over several runs: every run does what fits in its budget and
 * stops cleanly.
 *
 * Exit codes: 0 the series is published; 3 part of it is, run again; 1 a
 * refusal or a failure — nothing published changed either way.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  createReadStream,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  statfsSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isSlug } from "./lib/delivery-rules.mjs";
import { mediaConfig, minutesReport } from "./lib/media-publish.mjs";
import { parseFrameRate, splitDiskNeed, timecode } from "./lib/split-rules.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const slug = args[0];
const startedAt = Date.now();
/** How long an episode takes, per second of video, before anything is measured (2 vCPU runner). */
const FIRST_GUESS_SECONDS_PER_SECOND = 12;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".m4v", ".webm", ".ts", ".mpg", ".mpeg", ".avi"]);

function die(message, code = 1) {
  console.error(`cloud-ingest: ${message}`);
  process.exit(code);
}

function flag(name, fallback = null) {
  const at = args.indexOf(name);
  if (at === -1) return fallback;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) die(`${name} needs a value`);
  return value;
}

function step(script, scriptArgs) {
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", script), ...scriptArgs], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) die(`${script} could not start: ${result.error.message}`);
  return result.status ?? 1;
}

function capture(script, scriptArgs) {
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", script), ...scriptArgs], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk);
  return hash.digest("hex");
}

function summary(lines) {
  console.error(lines.join("\n"));
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${lines.join("\n")}\n`);
}

if (!slug || !isSlug(slug)) die(`usage: node scripts/cloud-ingest.mjs <series-slug> --source <file-or-folder>`);
const media = mediaConfig(process.env);
if (media.mode !== "r2") {
  die(
    media.mode === "error"
      ? `the media store is half configured:\n  - ${media.problems.join("\n  - ")}`
      : "no media store: set MEDIA_BASE_URL and the R2 secrets (docs/cloud-ingest.md). Nothing was downloaded or encoded",
  );
}
const deliveryRoot = resolve(flag("--delivery-root", join(repoRoot, "content", "series")));
const deliveryDir = join(deliveryRoot, slug);
const seriesFile = join(deliveryDir, "series.json");
if (!existsSync(seriesFile)) die(`${seriesFile} does not exist: commit series.json (and the captions) first`);
const delivery = JSON.parse(readFileSync(seriesFile, "utf8"));
const episodes = [...(delivery.episodes ?? [])].sort((a, b) => a.episodeNumber - b.episodeNumber);
if (episodes.length === 0) die("series.json lists no episodes");

const sourceArg = flag("--source");
if (!sourceArg) die("--source <file-or-folder> is required");
const source = resolve(sourceArg);
if (!existsSync(source)) die(`${source} does not exist`);
const budgetMinutes = Number(flag("--budget-minutes", "320"));
if (!Number.isFinite(budgetMinutes) || budgetMinutes <= 0) die("--budget-minutes must be a number of minutes");
/** Where ingest writes: its own defaults, unless a proof run gives it somewhere else. */
const ingestRoots = ["--generated-root", "--records-root", "--publish-root", "--stage-root"].flatMap((name) => {
  const value = flag(name);
  return value === null ? [] : [name, resolve(value)];
});

/** The one video file of a folder (or the file itself). */
function videoFile(path) {
  if (statSync(path).isFile()) return path;
  const found = readdirSync(path)
    .filter((name) => VIDEO_EXTENSIONS.has(extname(name).toLowerCase()))
    .map((name) => join(path, name));
  if (found.length === 0) die(`${path} holds no video file`);
  if (found.length > 1) {
    die(`${path} holds ${found.length} video files; a compilation delivery must be one file: ${found.map((file) => basename(file)).join(", ")}`);
  }
  return found[0];
}

/** Per-episode delivery: each file goes to the master path series.json names for it. */
function placeMasters(folder) {
  const available = new Map(
    (statSync(folder).isFile() ? [folder] : readdirSync(folder).map((name) => join(folder, name)))
      .filter((path) => statSync(path).isFile())
      .map((path) => [basename(path).toLowerCase(), path]),
  );
  const placed = [];
  const missing = [];
  for (const episode of episodes) {
    const target = resolve(deliveryDir, episode.master ?? "");
    const wanted = basename(target).toLowerCase();
    const found = available.get(wanted);
    if (!found) {
      if (!existsSync(target)) missing.push(`episode ${episode.episodeNumber}: no delivered file named ${basename(target)}`);
      continue;
    }
    if (existsSync(target) && statSync(target).size === statSync(found).size) continue;
    mkdirSync(resolve(target, ".."), { recursive: true });
    rmSync(target, { force: true });
    try {
      linkSync(found, target);
    } catch {
      copyFileSync(found, target);
    }
    placed.push(basename(target));
  }
  if (missing.length > 0) {
    die(
      `the delivery does not carry every episode:\n  - ${missing.join("\n  - ")}\n` +
        `  Delivered: ${[...available.keys()].join(", ") || "nothing"}. Rename the files, or fix "master" in series.json.`,
    );
  }
  return placed;
}

function diskFreeBytes(path) {
  try {
    const stats = statfsSync(path);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

const cutsPath = join(deliveryDir, "cuts.json");
const compilation = existsSync(cutsPath);
let cuts = null;
let sourceSha256 = null;
let sourceFile = null;

if (compilation) {
  sourceFile = videoFile(source);
  cuts = JSON.parse(readFileSync(cutsPath, "utf8"));
  const free = diskFreeBytes(deliveryRoot);
  const need = splitDiskNeed({ sourceBytes: statSync(sourceFile).size });
  if (free !== null && free < need) {
    die(
      `not enough disk: ${(free / 1e9).toFixed(1)} GB free, about ${(need / 1e9).toFixed(1)} GB needed for ${basename(sourceFile)} ` +
        "and the episodes cut from it. Ask for a shorter delivery, or a machine with more disk.",
    );
  }
  console.error(`cloud-ingest: hashing ${basename(sourceFile)} (${(statSync(sourceFile).size / 1e9).toFixed(2)} GB) …`);
  sourceSha256 = await sha256File(sourceFile);
  if (cuts.source?.sha256 !== sourceSha256) {
    die(
      `the link gave another file than the one the cuts were made for:\n` +
        `  cuts.json: ${String(cuts.source?.sha256).slice(0, 16)}…\n  delivered: ${sourceSha256.slice(0, 16)}…\n` +
        "  Run the workflow in propose-cuts mode on this file and confirm the new cuts.",
    );
  }
  // Provenance for every episode, without encoding: enough to know which are
  // already on the store, so a second run splits only what is left.
  const provenance = step("split-compilation.mjs", [
    "provenance",
    slug,
    "--input",
    sourceFile,
    "--sha256",
    sourceSha256,
    "--delivery-root",
    deliveryRoot,
  ]);
  if (provenance !== 0) die("the cuts file was refused: nothing was split", provenance);
} else {
  const placed = placeMasters(source);
  console.error(`cloud-ingest: ${placed.length} delivered file(s) placed as masters`);
}

const statusRun = capture("ingest-series.mjs", [slug, "--status", "--delivery-root", deliveryRoot, ...ingestRoots]);
if (statusRun.code !== 0) {
  console.error(statusRun.stderr);
  die("could not read what is already on the media store", statusRun.code);
}
const status = JSON.parse(statusRun.stdout);
const todo = status.episodes.filter((entry) => !entry.onStore).map((entry) => entry.episodeNumber);
console.error(
  `cloud-ingest: ${slug} — ${status.onStore} of ${status.episodes.length} episodes already on the media store, ${todo.length} to do`,
);

const fps = cuts ? parseFrameRate(cuts.source.frameRate) : null;
const episodeSeconds = (number) => {
  if (!cuts || !fps) return null;
  const bounds = [cuts.startFrame ?? 0, ...cuts.cuts.map((cut) => cut.frame), cuts.endFrame];
  return (bounds[number] - bounds[number - 1]) / fps;
};

const done = [];
const left = [];
let costPerSecond = FIRST_GUESS_SECONDS_PER_SECOND;
let measuredSeconds = 0;
let workedSeconds = 0;
let refusal = null;

for (const number of todo) {
  const spent = (Date.now() - startedAt) / 1000;
  const seconds = episodeSeconds(number);
  const estimate = (seconds ?? 120) * costPerSecond;
  if (spent + estimate > budgetMinutes * 60) {
    left.push(...todo.slice(todo.indexOf(number)));
    console.error(
      `cloud-ingest: stopping before episode ${number}: about ${(estimate / 60).toFixed(0)} min more than the ` +
        `${budgetMinutes} min budget allows (${(spent / 60).toFixed(0)} min used). ${left.length} episode(s) left for the next run.`,
    );
    break;
  }
  const episodeStarted = Date.now();
  if (compilation) {
    const split = step("split-compilation.mjs", [
      "split",
      slug,
      "--input",
      sourceFile,
      "--sha256",
      sourceSha256,
      "--episodes",
      String(number),
      "--delivery-root",
      deliveryRoot,
    ]);
    if (split !== 0) {
      refusal = `episode ${number} could not be cut`;
      break;
    }
  }
  const code = step("ingest-series.mjs", [
    slug,
    "--only",
    String(number),
    "--free-disk",
    "--delivery-root",
    deliveryRoot,
    ...ingestRoots,
  ]);
  if (compilation) {
    // The master goes; its provenance stays, so the next run knows this
    // episode is published without cutting it again.
    rmSync(resolve(deliveryDir, episodes[number - 1].master), { force: true });
  }
  if (code !== 0 && code !== 3) {
    refusal = `episode ${number} was refused (reasons above)`;
    break;
  }
  done.push(number);
  const took = (Date.now() - episodeStarted) / 1000;
  workedSeconds += took;
  if (seconds) {
    measuredSeconds += seconds;
    // What it really costs here, with a fifth of margin for the next episode.
    costPerSecond = (workedSeconds / measuredSeconds) * 1.2;
  }
  console.error(
    `cloud-ingest: episode ${number} done in ${(took / 60).toFixed(1)} min` +
      (seconds ? ` (${timecode(seconds)} of video, ${(took / seconds).toFixed(1)} s per second)` : ""),
  );
}

if (!refusal && done.length === 0 && left.length > 0) {
  // A run that can do nothing must not ask for another one: eight empty runs
  // would burn the month's minutes and publish nothing.
  refusal =
    `not one episode fits a budget of ${budgetMinutes} minutes (an episode of this delivery needs about ` +
    `${((episodeSeconds(left[0]) ?? 120) * costPerSecond / 60).toFixed(0)} minutes here). ` +
    "Raise --budget-minutes, or ask the studio for shorter episodes.";
}
if (!refusal && left.length === 0) {
  // Everything is on the store: write the manifest (no encoding happens here).
  const code = step("ingest-series.mjs", [slug, "--delivery-root", deliveryRoot, ...ingestRoots]);
  if (code === 3) left.push(...todo.filter((number) => !done.includes(number)));
  else if (code !== 0) refusal = "the series was refused when the manifest was written (reasons above)";
}

const report = minutesReport({
  startedAtMs: startedAt,
  endedAtMs: Date.now(),
  videoSeconds: measuredSeconds,
});
const lines = [
  `### ${slug}: ${refusal ? "refused" : left.length > 0 ? "part of the series" : "published"}`,
  "",
  `- episodes published in this run: ${done.length} (${done.join(", ") || "none"})`,
  `- still to do: ${left.length}${left.length > 0 ? ` (${left.join(", ")})` : ""}`,
  `- this run used about **${report.minutes} runner minutes**` +
    (report.perVideoMinute ? `, ${report.perVideoMinute.toFixed(1)} per minute of video` : ""),
  report.videoMinutesPerMonth
    ? `- at that rate the 2,000 free minutes of a month cover about **${report.videoMinutesPerMonth.toFixed(0)} minutes of video**`
    : "- no video was encoded in this run",
];
if (refusal) lines.push(`- ${refusal}`);
if (left.length > 0) lines.push("- run the workflow again with the same inputs to continue");
summary(lines);

if (refusal) process.exit(1);
process.exit(left.length > 0 ? 3 : 0);
