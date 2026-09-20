/**
 * Proves the content pipeline on real files: deliveries built here with
 * ffmpeg and ingested for real.
 *
 *   node scripts/gate-proof.mjs [--keep]
 *
 * A check that has never failed is not a check (docs/standard.md). This run:
 *
 *   - breaks each rule on purpose — silent audio, a black opening, a
 *     horizontal master, a landscape picture hiding behind a rotation flag, a
 *     missing caption file, the same master twice, a territory the site cannot
 *     restrict, a caption language outside the licence, an episode slug that
 *     climbs out of its folder — and fails unless each is refused FOR THE
 *     RIGHT REASON;
 *   - delivers what real short drama looks like — a fade to black, an end
 *     card, a freeze-frame cliffhanger, a vertical master stored sideways with
 *     a rotation flag — and fails unless each is accepted;
 *   - re-delivers over a published series and fails unless a refusal leaves
 *     every published file and the manifest byte for byte as they were, a
 *     re-run of an unchanged delivery changes nothing, the fixed delivery
 *     resumes what already passed, and a corrected audio stream is re-judged.
 *
 * Nothing touches the repository: deliveries, published assets, the stage and
 * manifests all go to a temporary folder.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeMediaStore } from "./lib/fake-media-store.mjs";
import { IMMUTABLE } from "./lib/platform.mjs";
import { MEDIA_ENV } from "./lib/media-publish.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const source = join(repoRoot, "content", "series", "signal-night");
const keep = process.argv.includes("--keep");
const work = mkdtempSync(join(tmpdir(), "flow-gate-proof-"));
const SLUG = "proof-pack";

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(`gate-proof: ffmpeg failed\n${(result.stderr ?? "").slice(-1500)}`);
    process.exit(1);
  }
}

const goodMaster = join(source, "masters", "episode-1.mp4");
const otherMaster = join(source, "masters", "episode-3.mp4");
const goodCaptions = join(source, "captions", "episode-1.en.vtt");
const X264 = ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac"];

/** The good master, then two more seconds of `tail` with the music going on. */
const withTail = (tail) => (target) =>
  ffmpeg([
    "-i",
    goodMaster,
    "-f",
    "lavfi",
    "-i",
    `${tail}:s=720x1280:d=2:r=25`,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:duration=2",
    "-filter_complex",
    "[0:v][0:a][1:v][2:a]concat=n=2:v=1:a=1[v][a]",
    "-map",
    "[v]",
    "-map",
    "[a]",
    ...X264,
    target,
  ]);

const masters = {
  good: (target) => cpSync(goodMaster, target),
  other: (target) => cpSync(otherMaster, target),
  silentAudio: (target) =>
    ffmpeg(["-i", goodMaster, "-af", "volume=0", "-c:v", "copy", "-c:a", "aac", target]),
  blackOpening: (target) =>
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=720x1280:d=3:r=25",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:duration=3",
      "-i",
      goodMaster,
      "-filter_complex",
      "[0:v][1:a][2:v][2:a]concat=n=2:v=1:a=1[v][a]",
      "-map",
      "[v]",
      "-map",
      "[a]",
      ...X264,
      target,
    ]),
  horizontal: (target) =>
    ffmpeg(["-i", goodMaster, "-vf", "scale=1280:720,setsar=1", ...X264.slice(0, 6), "-c:a", "copy", target]),
  /** Vertical pixels, a flag that turns them landscape: the viewer sees 1280x720. */
  landscapeBehindFlag: (target) =>
    ffmpeg(["-display_rotation", "90", "-i", goodMaster, "-c", "copy", target]),
  /** Landscape pixels, a flag that turns them vertical: the viewer sees 720x1280. */
  verticalBehindFlag: (target) => {
    const sideways = `${target}.sideways.mp4`;
    ffmpeg(["-i", goodMaster, "-vf", "transpose=2", ...X264.slice(0, 6), "-c:a", "copy", sideways]);
    ffmpeg(["-display_rotation", "-90", "-i", sideways, "-c", "copy", target]);
    rmSync(sideways);
  },
  fadeToBlackEnding: withTail("color=c=black"),
  endCardEnding: withTail("color=c=0x3040a0"),
  freezeFrameEnding: (target) =>
    ffmpeg([
      "-i",
      goodMaster,
      "-vf",
      "tpad=stop_mode=clone:stop_duration=2.5",
      "-af",
      "apad=pad_dur=2.5",
      ...X264,
      target,
    ]),
  /** A studio recut: one second shorter. */
  recut: (target) => ffmpeg(["-i", otherMaster, "-t", "9", ...X264, target]),
  /** Stream 0 is the dialogue bed, stream 1 a 1 kHz tone (the wrong stem). */
  twoAudio: (target) =>
    ffmpeg([
      "-i",
      goodMaster,
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:duration=10",
      "-map",
      "0:v",
      "-map",
      "0:a",
      "-map",
      "1:a",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      target,
    ]),
};

function episode(number, extra = {}) {
  return {
    episodeNumber: number,
    master: `masters/episode-${number}.mp4`,
    title: `Proof ${number}`,
    hook: "Gate proof.",
    captions: [
      { language: "en", file: `captions/episode-${number}.en.vtt`, kind: "captions", default: true },
    ],
    ...extra,
  };
}

function seriesJson(episodes, extra = {}) {
  return {
    schemaVersion: 1,
    seriesId: "series_proof",
    seriesSlug: SLUG,
    title: "Proof Pack",
    status: "published",
    defaultLocale: "en",
    producerId: "prod_proof",
    producerOfRecord: "PROJECT FLOW — gate proof",
    socialClipsAllowed: false,
    allowBelow1080p: true,
    episodeDurationMs: { min: 8000, max: 20000 },
    genres: ["thriller"],
    tropes: ["night"],
    rights: { territories: ["WORLD"], languages: ["en"], windowStart: null, windowEnd: null },
    localizedMetadata: {
      en: { title: "Proof Pack", hook: "Gate proof.", description: "Gate proof." },
    },
    episodes,
    ...extra,
  };
}

/** One case = its own delivery, publish, stage and generated roots. */
function caseRoots(name) {
  const root = join(work, name);
  const delivery = join(root, "delivery", SLUG);
  mkdirSync(join(delivery, "masters"), { recursive: true });
  mkdirSync(join(delivery, "captions"), { recursive: true });
  return {
    root,
    delivery,
    published: join(root, "published"),
    generated: join(root, "generated"),
    deliver({ masterBuilders, episodes, extra, captions = true }) {
      for (const [number, build] of Object.entries(masterBuilders)) {
        build(join(delivery, "masters", `episode-${number}.mp4`));
      }
      if (captions) {
        for (const number of Object.keys(masterBuilders)) {
          cpSync(goodCaptions, join(delivery, "captions", `episode-${number}.en.vtt`));
        }
      }
      const list = episodes ?? Object.keys(masterBuilders).map((number) => episode(Number(number)));
      writeFileSync(join(delivery, "series.json"), `${JSON.stringify(seriesJson(list, extra), null, 2)}\n`);
    },
    ingest() {
      const result = spawnSync(
        process.execPath,
        [
          join(repoRoot, "scripts", "ingest-series.mjs"),
          SLUG,
          "--delivery-root",
          join(root, "delivery"),
          "--publish-root",
          join(root, "published"),
          "--generated-root",
          join(root, "generated"),
        ],
        // Media in the export: whatever this machine's environment says.
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: exportEnv },
      );
      return { accepted: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
    },
    /** Ingest with media on the (fake) store; async, because the store answers from this process. */
    ingestToStore(env, extra = []) {
      return new Promise((done) => {
        const child = spawn(
          process.execPath,
          [
            join(repoRoot, "scripts", "ingest-series.mjs"),
            SLUG,
            "--delivery-root",
            join(root, "delivery"),
            "--publish-root",
            join(root, "published"),
            "--generated-root",
            join(root, "generated"),
            ...extra,
          ],
          { env: { ...exportEnv, ...env } },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("close", (code) => done({ code, accepted: code === 0, stdout, output: `${stdout}${stderr}` }));
      });
    },
  };
}

/** The environment without any media-store variable: the export cases stay export cases. */
const exportEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !MEDIA_ENV.includes(name) && name !== "R2_ENDPOINT"),
);

/** Every published file and the generated manifest, by content. */
function snapshot(roots) {
  const out = new Map();
  const walk = (dir, prefix) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const rel = `${prefix}/${name}`;
      if (statSync(path).isDirectory()) walk(path, rel);
      else out.set(rel, createHash("sha256").update(readFileSync(path)).digest("hex"));
    }
  };
  walk(roots.published, "published");
  walk(roots.generated, "generated");
  return out;
}

/** Per published episode: the revision its record names, and the folders next to it. */
function revisionsOf(roots) {
  const out = new Map();
  const hls = join(roots.published, SLUG, "hls");
  if (!existsSync(hls)) return out;
  for (const episodeSlug of readdirSync(hls)) {
    const dir = join(hls, episodeSlug);
    const recordPath = join(dir, "manifest.json");
    if (!existsSync(recordPath)) continue;
    out.set(episodeSlug, {
      revision: JSON.parse(readFileSync(recordPath, "utf8")).revision ?? null,
      folders: readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory()),
    });
  }
  return out;
}

function sameSnapshot(before, after) {
  const changed = [];
  for (const [rel, hash] of before) if (after.get(rel) !== hash) changed.push(rel);
  for (const rel of after.keys()) if (!before.has(rel)) changed.push(`${rel} (new)`);
  return changed;
}

const results = [];
function record(name, ok, detail, output = "") {
  results.push({ name, ok, detail, output });
}

/** A single delivery that must be refused, naming one of `reasons`. */
function refusal(name, build, reasons) {
  const roots = caseRoots(name.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  build(roots);
  const run = roots.ingest();
  const found = reasons.filter((reason) => run.output.includes(reason));
  const published = existsSync(join(roots.published, SLUG));
  record(
    name,
    !run.accepted && found.length > 0 && !published,
    run.accepted
      ? "ACCEPTED, should be refused"
      : `REFUSED (${found.join(", ") || "for another reason"})${published ? ", but files were published" : ""}`,
    run.output,
  );
}

/** A single delivery that must be accepted; `check` inspects what it produced. */
function acceptance(name, build, check = () => null) {
  const roots = caseRoots(name.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
  build(roots);
  const run = roots.ingest();
  const problem = run.accepted ? check(roots, run.output) : "REFUSED, should be accepted";
  record(name, problem === null, problem ?? "ACCEPTED", run.output);
}

// --- refused, for the right reason -----------------------------------------

refusal("silent audio", (r) => r.deliver({ masterBuilders: { 1: masters.silentAudio } }), [
  "[silent_opening]",
  "[mostly_silent]",
]);
refusal("black opening", (r) => r.deliver({ masterBuilders: { 1: masters.blackOpening } }), [
  "[black_opening]",
]);
refusal("horizontal master", (r) => r.deliver({ masterBuilders: { 1: masters.horizontal } }), [
  "[not_vertical]",
]);
refusal(
  "landscape picture behind a rotation flag",
  (r) => r.deliver({ masterBuilders: { 1: masters.landscapeBehindFlag } }),
  ["[not_vertical] 1280x720"],
);
refusal(
  "missing caption file",
  (r) => r.deliver({ masterBuilders: { 1: masters.good }, captions: false }),
  ["[missing_caption_file]"],
);
refusal(
  "the same master twice",
  (r) => r.deliver({ masterBuilders: { 1: masters.good, 2: masters.good } }),
  ["[duplicate_master]"],
);
refusal(
  "a territory the site cannot restrict",
  (r) =>
    r.deliver({
      masterBuilders: { 1: masters.good },
      extra: { rights: { territories: ["US"], languages: ["en"], windowStart: null, windowEnd: null } },
    }),
  ["rights.territories is"],
);
refusal(
  "a caption language outside the licence",
  (r) =>
    r.deliver({
      masterBuilders: { 1: masters.good },
      episodes: [
        episode(1, {
          captions: [
            { language: "en", file: "captions/episode-1.en.vtt", kind: "captions", default: true },
            { language: "fr", file: "captions/episode-1.en.vtt", kind: "subtitles", default: false },
          ],
        }),
      ],
    }),
  ["[caption_language_not_licensed]"],
);
refusal(
  "an episode slug that leaves its folder",
  (r) =>
    r.deliver({ masterBuilders: { 1: masters.good }, episodes: [episode(1, { episodeSlug: ".." })] }),
  ["[bad_episode_slug]"],
);

// --- accepted: what real short drama looks like ----------------------------

const hasPoster = (roots) =>
  existsSync(join(roots.published, SLUG, "posters", "episode-1.webp")) &&
  existsSync(join(roots.published, SLUG, "share", "episode-1.jpg"))
    ? null
    : "no poster or share card was published";

acceptance("good", (r) => r.deliver({ masterBuilders: { 1: masters.good } }), (roots) => {
  const manifest = readFileSync(join(roots.generated, `${SLUG}.ts`), "utf8");
  if (!manifest.includes("shareCardReference") || !manifest.includes(".webp")) {
    return "the manifest names no share card or no WebP poster";
  }
  return hasPoster(roots);
});
/** Accepted BECAUSE of the rule, not because the still went unnoticed. */
const stillSeenAndAccepted = (roots) => {
  const path = join(roots.published, SLUG, "hls", "episode-1", "manifest.json");
  const stills = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).picture?.freezeRanges : 0;
  if (!(stills >= 1)) return "the still ending was never detected, so the rule was not exercised";
  return hasPoster(roots);
};
acceptance(
  "a fade to black ending",
  (r) => r.deliver({ masterBuilders: { 1: masters.fadeToBlackEnding } }),
  stillSeenAndAccepted,
);
acceptance(
  "an end card ending",
  (r) => r.deliver({ masterBuilders: { 1: masters.endCardEnding } }),
  stillSeenAndAccepted,
);
acceptance(
  "a freeze-frame cliffhanger",
  (r) => r.deliver({ masterBuilders: { 1: masters.freezeFrameEnding } }),
  stillSeenAndAccepted,
);
acceptance(
  "a vertical master stored sideways with a rotation flag",
  (r) => r.deliver({ masterBuilders: { 1: masters.verticalBehindFlag } }),
  (roots) => {
    const episodeDir = join(roots.published, SLUG, "hls", "episode-1");
    const { revision } = JSON.parse(readFileSync(join(episodeDir, "manifest.json"), "utf8"));
    const playlist = readFileSync(join(episodeDir, revision, "master.m3u8"), "utf8");
    const sizes = [...playlist.matchAll(/RESOLUTION=(\d+)x(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    if (sizes.length === 0 || sizes.some(([w, h]) => w >= h)) {
      return `renditions are not vertical: ${sizes.map((s) => s.join("x")).join(", ")}`;
    }
    const manifest = readFileSync(join(roots.generated, `${SLUG}.ts`), "utf8");
    if (!/"width": 720,\s*"height": 1280/.test(manifest)) return "the manifest does not record 720x1280";
    return null;
  },
);

// --- a published series survives a bad re-delivery -------------------------
{
  const name = "a refused re-delivery changes nothing published";
  const roots = caseRoots("redelivery");
  roots.deliver({ masterBuilders: { 1: masters.good, 2: masters.other } });
  const first = roots.ingest();
  if (!first.accepted) {
    record(name, false, "the first, good delivery was refused", first.output);
  } else {
    const before = snapshot(roots);
    const revisionsBefore = revisionsOf(roots);

    // The studio re-delivers: episode 1 is a new valid master, episode 2 is a
    // recut whose subtitles were cut off halfway.
    masters.recut(join(roots.delivery, "masters", "episode-1.mp4"));
    ffmpeg(["-i", goodMaster, "-t", "9.5", ...X264, join(roots.delivery, "masters", "episode-2.mp4")]);
    writeFileSync(
      join(roots.delivery, "captions", "episode-2.en.vtt"),
      "WEBVTT\n\n00:00:00.500 --> 00:00:02.500\nSomething is wrong.\n\n00:00:03.000 --> 00:00:04.500\nDo not answer.\n",
    );
    const refused = roots.ingest();
    const changedByRefusal = sameSnapshot(before, snapshot(roots));

    // A numbering typo: episode 2 declared as episode 1 again.
    const deliveryFile = join(roots.delivery, "series.json");
    const fixedJson = readFileSync(deliveryFile, "utf8");
    const typo = JSON.parse(fixedJson);
    typo.episodes[1].episodeNumber = 1;
    writeFileSync(deliveryFile, JSON.stringify(typo, null, 2));
    const typoRun = roots.ingest();
    const changedByTypo = sameSnapshot(before, snapshot(roots));
    writeFileSync(deliveryFile, fixedJson);

    const problems = [];
    if (refused.accepted || !refused.output.includes("[stops_too_early]")) {
      problems.push("the truncated subtitles were not refused");
    }
    if (typoRun.accepted || !typoRun.output.includes("[duplicate_episode_number]")) {
      problems.push("the numbering typo was not refused");
    }
    if (changedByRefusal.length > 0) {
      problems.push(`the refusal changed ${changedByRefusal.length} published file(s): ${changedByRefusal.slice(0, 4).join(", ")}`);
    }
    if (changedByTypo.length > 0) {
      problems.push(`the typo changed ${changedByTypo.length} published file(s): ${changedByTypo.slice(0, 4).join(", ")}`);
    }
    record(
      name,
      problems.length === 0,
      problems.join("; ") || `both refused; ${before.size} published files byte-identical`,
      `${refused.output}\n${typoRun.output}`,
    );

    // The fixed delivery resumes the renditions that already passed.
    cpSync(goodCaptions, join(roots.delivery, "captions", "episode-2.en.vtt"));
    const fixed = roots.ingest();
    const resumed = /resumed from the stage: (\d+)/.exec(fixed.output)?.[1];
    record(
      "the fixed delivery resumes what already passed",
      fixed.accepted && resumed === "2" && /packaged now: 0/.test(fixed.output),
      fixed.accepted ? `packaged now 0, resumed ${resumed ?? "?"}` : "the fixed delivery was refused",
      fixed.output,
    );

    // A new cut is a new URL: HLS is cached for a year (docs/decisions.md,
    // batch 5), so the recut may never be served where the old cut was.
    const revisionsAfter = revisionsOf(roots);
    const manifestText = readFileSync(join(roots.generated, `${SLUG}.ts`), "utf8");
    const urlProblems = [];
    for (const episodeSlug of ["episode-1", "episode-2"]) {
      const was = revisionsBefore.get(episodeSlug);
      const now = revisionsAfter.get(episodeSlug);
      if (!was || !now || was.revision === now.revision) {
        urlProblems.push(`${episodeSlug} kept revision ${now?.revision ?? "none"}`);
      } else if (now.folders.length !== 1) {
        urlProblems.push(`${episodeSlug} holds ${now.folders.length} revision folders`);
      } else if (!manifestText.includes(`/hls/${episodeSlug}/${now.revision}/master.m3u8`)) {
        urlProblems.push(`the manifest does not point ${episodeSlug} at ${now.revision}`);
      }
    }
    record(
      "a new cut is published under a new URL",
      fixed.accepted && urlProblems.length === 0,
      urlProblems.join("; ") ||
        [...revisionsAfter]
          .map(([slug, entry]) => `${slug} ${revisionsBefore.get(slug)?.revision} → ${entry.revision}`)
          .join(", "),
      fixed.output,
    );

    // The same delivery again: nothing is encoded, nothing published changes.
    const settled = snapshot(roots);
    const again = roots.ingest();
    const changedByRerun = sameSnapshot(settled, snapshot(roots));
    record(
      "an unchanged delivery changes nothing",
      again.accepted && /packaged now: 0/.test(again.output) && changedByRerun.length === 0,
      again.accepted
        ? `packaged now ${/packaged now: (\d+)/.exec(again.output)?.[1]}, ${changedByRerun.length} file(s) changed`
        : "refused",
      again.output,
    );
  }
}

// --- a corrected gate option is judged again -------------------------------
{
  const name = "a corrected audio stream is re-encoded";
  const roots = caseRoots("audio-stream");
  roots.deliver({
    masterBuilders: { 1: masters.twoAudio },
    episodes: [episode(1, { audioStream: 1 })],
  });
  const wrong = roots.ingest();
  const deliveryFile = join(roots.delivery, "series.json");
  const corrected = JSON.parse(readFileSync(deliveryFile, "utf8"));
  corrected.episodes[0].audioStream = 0;
  writeFileSync(deliveryFile, JSON.stringify(corrected, null, 2));
  const right = roots.ingest();
  const recordPath = join(roots.published, SLUG, "hls", "episode-1", "manifest.json");
  const stream = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")).audioStream : null;
  record(
    name,
    wrong.accepted && right.accepted && /packaged now: 1/.test(right.output) && stream === 0,
    `second run ${/packaged now: (\d+)/.exec(right.output)?.[0] ?? "refused"}, published audioStream ${stream}`,
    `${wrong.output}\n${right.output}`,
  );
}

// --- media on R2 (docs/cloud-ingest.md) --------------------------------------
// The real ingest, against a local store that checks every signature the way
// R2 does and serves what it holds the way a public bucket domain does.
{
  const credentials = { bucket: "proof-media", accessKeyId: "AKIDPROOF", secretAccessKey: "proof-secret-never-printed" };
  const store = await startFakeMediaStore({ ...credentials, allowedOrigins: ["*"] });
  const env = {
    MEDIA_BASE_URL: store.endpoint,
    R2_ENDPOINT: store.endpoint,
    R2_ACCESS_KEY_ID: credentials.accessKeyId,
    R2_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    R2_BUCKET: credentials.bucket,
  };
  const manifestOf = (roots) => {
    const path = join(roots.generated, `${SLUG}.ts`);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };
  const urlsIn = (text) => [...(text ?? "").matchAll(/"(https?:\/\/[^"]+)"/g)].map((match) => match[1]);
  /** Every URL of the manifest, and every segment its playlists name, is on the store's public side. */
  const closure = async (text) => {
    const problems = [];
    let objects = 0;
    for (const url of urlsIn(text)) {
      const response = await fetch(url);
      objects += 1;
      if (response.status !== 200) {
        problems.push(`${url} answered ${response.status}`);
        continue;
      }
      if (response.headers.get("cache-control") !== IMMUTABLE) problems.push(`${url} is not cached for a year`);
      if (!url.endsWith("master.m3u8")) continue;
      for (const variant of (await response.text()).split("\n").filter((line) => line && !line.startsWith("#"))) {
        const variantUrl = new URL(variant, url).href;
        const playlist = await fetch(variantUrl);
        objects += 1;
        const body = await playlist.text();
        const names = [
          ...body.split("\n").filter((line) => line && !line.startsWith("#")),
          ...[...body.matchAll(/URI="([^"]+)"/g)].map((match) => match[1]),
        ];
        for (const name of names) {
          const head = await fetch(new URL(name, variantUrl).href, { method: "HEAD" });
          objects += 1;
          if (head.status !== 200) problems.push(`${name} of ${variant} is missing`);
        }
      }
    }
    return { problems, objects };
  };

  // 1. A delivery goes to the store; the manifest points there; nothing lands in the export.
  const roots = caseRoots("r2");
  roots.deliver({ masterBuilders: { 1: masters.good, 2: masters.other } });
  const first = await roots.ingestToStore(env);
  const firstManifest = manifestOf(roots);
  {
    const problems = [];
    if (!first.accepted) problems.push("refused");
    const urls = urlsIn(firstManifest);
    if (urls.length === 0 || urls.some((url) => !url.startsWith(`${store.endpoint}/content/series/${SLUG}/`))) {
      problems.push(`the manifest does not point at MEDIA_BASE_URL: ${urls.slice(0, 2).join(", ")}`);
    }
    if (/"\/content\/series\//.test(firstManifest ?? "")) problems.push("the manifest still names export paths");
    if (existsSync(join(roots.published, SLUG))) problems.push("files were written into the export");
    const { problems: missing, objects } = first.accepted ? await closure(firstManifest) : { problems: [], objects: 0 };
    problems.push(...missing);
    // master.m3u8 goes last in each folder: a playlist never names a missing segment.
    const puts = store.log.filter((entry) => entry.method === "PUT" && entry.status === 200).map((entry) => entry.key);
    for (const key of puts.filter((name) => name.endsWith("/master.m3u8"))) {
      const folder = key.slice(0, -"master.m3u8".length);
      const lastOfFolder = puts.filter((name) => name.startsWith(folder)).pop();
      if (lastOfFolder !== key) problems.push(`${folder} was not finished by its master playlist`);
    }
    record(
      "media on R2: a delivery is published to the store and the manifest points there",
      problems.length === 0,
      problems.join("; ") || `${puts.length} objects uploaded, ${objects} fetched back through the public side, all cached for a year; nothing in the export`,
      first.output,
    );
  }

  // 2. The same delivery again: nothing encoded, nothing uploaded, manifest unchanged.
  store.log.length = 0;
  const again = await roots.ingestToStore(env);
  const puts = store.log.filter((entry) => entry.method === "PUT").length;
  record(
    "media on R2: the same delivery again encodes and uploads nothing",
    again.accepted && /packaged now: 0/.test(again.output) && puts === 0 && manifestOf(roots) === firstManifest,
    `packaged now ${/packaged now: (\d+)/.exec(again.output)?.[1] ?? "?"}, ${puts} PUT, ${store.log.filter((entry) => entry.method === "HEAD").length} HEAD, manifest ${manifestOf(roots) === firstManifest ? "unchanged" : "CHANGED"}`,
    again.output,
  );

  // 3. A refused re-delivery writes no manifest; what it pointed at stays on the store.
  masters.recut(join(roots.delivery, "masters", "episode-1.mp4"));
  writeFileSync(
    join(roots.delivery, "captions", "episode-2.en.vtt"),
    "WEBVTT\n\n00:00:00.500 --> 00:00:02.500\nSomething is wrong.\n",
  );
  const refusedRun = await roots.ingestToStore(env);
  const stillThere = await closure(firstManifest);
  record(
    "media on R2: a refused re-delivery changes no manifest, and the published objects stay",
    !refusedRun.accepted && refusedRun.output.includes("[stops_too_early]") && manifestOf(roots) === firstManifest &&
      stillThere.problems.length === 0,
    `${refusedRun.accepted ? "ACCEPTED" : "refused"}, manifest ${manifestOf(roots) === firstManifest ? "byte-identical" : "CHANGED"}, ${stillThere.objects} published objects still served`,
    refusedRun.output,
  );

  // 4. A series longer than one run: --only, incomplete until the last run.
  {
    const long = caseRoots("r2-long");
    long.deliver({
      masterBuilders: {
        1: masters.good,
        2: (target) => cpSync(join(source, "masters", "episode-2.mp4"), target),
        3: masters.other,
      },
    });
    const part = await long.ingestToStore(env, ["--only", "1"]);
    const status = await long.ingestToStore(env, ["--status"]);
    let onStore = null;
    try {
      onStore = JSON.parse(status.stdout).onStore;
    } catch {
      onStore = null;
    }
    const rest = await long.ingestToStore(env, ["--only", "2-3", "--free-disk"]);
    const manifest = manifestOf(long);
    const episodes = [...(manifest ?? "").matchAll(/"episodeNumber": (\d+)/g)].length;
    record(
      "media on R2: a series published over several runs is incomplete until the last",
      part.code === 3 && /INCOMPLETE/.test(part.output) && onStore === 1 && rest.accepted && episodes === 3 &&
        /packaged now: 2/.test(rest.output) && /unchanged: 1/.test(rest.output) &&
        !existsSync(join(long.root, ".ingest-stage", SLUG)),
      `first run exit ${part.code} (${/INCOMPLETE/.test(part.output) ? "incomplete, no manifest" : "?"}), status ${onStore}/3 on the store, ` +
        `second run ${rest.accepted ? `ok, ${episodes} episodes` : "refused"}`,
      `${part.output}\n${status.output}\n${rest.output}`,
    );
  }

  // 5. Half configured, or a wrong key: refused, saying why, printing no secret.
  {
    const half = caseRoots("r2-half");
    half.deliver({ masterBuilders: { 1: masters.good } });
    const run = await half.ingestToStore({ MEDIA_BASE_URL: store.endpoint, R2_SECRET_ACCESS_KEY: credentials.secretAccessKey });
    record(
      "media on R2: a half-configured environment is refused, naming what is missing, printing no secret",
      !run.accepted && run.output.includes("R2_BUCKET") && !run.output.includes(credentials.secretAccessKey) && manifestOf(half) === null,
      run.accepted ? "ACCEPTED" : "refused before any work",
      run.output,
    );
    const wrong = caseRoots("r2-wrong-key");
    wrong.deliver({ masterBuilders: { 1: masters.good } });
    const denied = await wrong.ingestToStore({ ...env, R2_SECRET_ACCESS_KEY: "not-the-secret" });
    record(
      "media on R2: a wrong key stops the run with the store's answer, no manifest",
      !denied.accepted && /answered 403 \(the R2 token/.test(denied.output) &&
        !denied.output.includes("not-the-secret") && manifestOf(wrong) === null,
      denied.accepted ? "ACCEPTED" : `stopped: ${/answered 403[^)]*\)/.exec(denied.output)?.[0] ?? "?"}`,
      denied.output,
    );
  }
  await store.close();
}

console.error("\ngate-proof: one delivery per rule\n");
for (const result of results) {
  console.error(`  ${result.ok ? "ok  " : "FAIL"}  ${result.name} — ${result.detail}`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  for (const result of failed) {
    console.error(`\n--- ${result.name} ---\n${result.output.slice(-3000)}`);
  }
  console.error(`\ngate-proof: ${failed.length} case(s) did not behave as declared`);
  if (!keep) rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

console.error(`\ngate-proof: ${results.length} cases, all as declared`);
if (keep) console.error(`gate-proof: files kept in ${work}`);
else rmSync(work, { recursive: true, force: true });
