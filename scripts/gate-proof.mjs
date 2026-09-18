/**
 * Proves the content gate on real files: one good delivery and five broken
 * ones, built here with ffmpeg and ingested for real.
 *
 *   node scripts/gate-proof.mjs [--keep]
 *
 * A check that has never failed is not a check (docs/standard.md). This run
 * breaks each rule on purpose — silent audio, a black opening, a horizontal
 * master, a missing caption file, the same master twice — and fails unless
 * the gate refuses each one FOR THE RIGHT REASON, and accepts the good one.
 *
 * Nothing touches the repository: deliveries, published assets and manifests
 * all go to a temporary folder.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const source = join(repoRoot, "content", "series", "signal-night");
const keep = process.argv.includes("--keep");
const work = mkdtempSync(join(tmpdir(), "flow-gate-proof-"));

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

/** A delivery with one episode, unless `episodes` says otherwise. */
function delivery(name, { masters, episodes, captions = true }) {
  const dir = join(work, name, "delivery", "proof-pack");
  mkdirSync(join(dir, "masters"), { recursive: true });
  mkdirSync(join(dir, "captions"), { recursive: true });
  for (const [file, build] of Object.entries(masters)) build(join(dir, "masters", file));
  if (captions) {
    cpSync(
      join(source, "captions", "episode-1.en.vtt"),
      join(dir, "captions", "episode-1.en.vtt"),
    );
    cpSync(
      join(source, "captions", "episode-1.en.vtt"),
      join(dir, "captions", "episode-2.en.vtt"),
    );
  }
  const series = {
    schemaVersion: 1,
    seriesId: "series_proof",
    seriesSlug: "proof-pack",
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
    rights: {
      territories: ["WORLD"],
      languages: ["en"],
      windowStart: null,
      windowEnd: null,
    },
    localizedMetadata: {
      en: { title: "Proof Pack", hook: "Gate proof.", description: "Gate proof." },
    },
    episodes: episodes ?? [
      {
        episodeNumber: 1,
        master: "masters/episode-1.mp4",
        title: "Proof",
        hook: "Gate proof.",
        captions: [
          {
            language: "en",
            file: "captions/episode-1.en.vtt",
            kind: "captions",
            default: true,
          },
        ],
      },
    ],
  };
  writeFileSync(join(dir, "series.json"), `${JSON.stringify(series, null, 2)}\n`);
  return join(work, name, "delivery");
}

const goodMaster = join(source, "masters", "episode-1.mp4");

const copyGood = (target) => cpSync(goodMaster, target);
const silentAudio = (target) =>
  ffmpeg(["-i", goodMaster, "-af", "volume=0", "-c:v", "copy", "-c:a", "aac", target]);
const blackOpening = (target) =>
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
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    target,
  ]);
const horizontal = (target) =>
  ffmpeg([
    "-i",
    goodMaster,
    "-vf",
    "scale=1280:720,setsar=1",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    target,
  ]);

const cases = [
  {
    name: "good",
    expect: "accepted",
    root: () => delivery("good", { masters: { "episode-1.mp4": copyGood } }),
  },
  {
    name: "silent audio",
    expect: "refused",
    reasons: ["silent_opening", "mostly_silent"],
    root: () => delivery("silent", { masters: { "episode-1.mp4": silentAudio } }),
  },
  {
    name: "black opening",
    expect: "refused",
    reasons: ["black_opening"],
    root: () => delivery("black", { masters: { "episode-1.mp4": blackOpening } }),
  },
  {
    name: "horizontal master",
    expect: "refused",
    reasons: ["not_vertical"],
    root: () => delivery("horizontal", { masters: { "episode-1.mp4": horizontal } }),
  },
  {
    name: "missing caption file",
    expect: "refused",
    reasons: ["missing_caption_file"],
    root: () =>
      delivery("nocaptions", { masters: { "episode-1.mp4": copyGood }, captions: false }),
  },
  {
    name: "the same master twice",
    expect: "refused",
    reasons: ["duplicate_master"],
    root: () =>
      delivery("duplicate", {
        masters: { "episode-1.mp4": copyGood, "episode-2.mp4": copyGood },
        episodes: [1, 2].map((number) => ({
          episodeNumber: number,
          master: `masters/episode-${number}.mp4`,
          title: `Proof ${number}`,
          hook: "Gate proof.",
          captions: [
            {
              language: "en",
              file: `captions/episode-${number}.en.vtt`,
              kind: "captions",
              default: true,
            },
          ],
        })),
      }),
  },
];

const results = [];
for (const entry of cases) {
  const deliveryRoot = entry.root();
  const caseDir = resolve(deliveryRoot, "..");
  const run = spawnSync(
    process.execPath,
    [
      join(repoRoot, "scripts", "ingest-series.mjs"),
      "proof-pack",
      "--delivery-root",
      deliveryRoot,
      "--publish-root",
      join(caseDir, "published"),
      "--generated-root",
      join(caseDir, "generated"),
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const accepted = run.status === 0;
  const reasons = (entry.reasons ?? []).filter((reason) => output.includes(`[${reason}]`));
  const wanted = entry.expect === "accepted";
  const ok = accepted === wanted && (wanted || reasons.length > 0);
  results.push({ name: entry.name, accepted, reasons, ok, output });
}

console.error("\ngate-proof: one delivery per rule\n");
for (const result of results) {
  const verdict = result.accepted ? "ACCEPTED" : "REFUSED ";
  const why = result.reasons.length > 0 ? ` (${result.reasons.join(", ")})` : "";
  console.error(`  ${result.ok ? "ok  " : "FAIL"}  ${verdict}  ${result.name}${why}`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  for (const result of failed) {
    console.error(`\n--- ${result.name} ---\n${result.output.slice(-2500)}`);
  }
  console.error(`\ngate-proof: ${failed.length} case(s) did not behave as declared`);
  if (!keep) rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

// The good delivery must also have produced the files it promises.
const generated = join(work, "good", "generated", "proof-pack.ts");
const manifest = readFileSync(generated, "utf8");
if (!manifest.includes("shareCardReference") || !manifest.includes(".webp")) {
  console.error("gate-proof: the accepted delivery produced no share card or no WebP poster");
  process.exit(1);
}

console.error(`\ngate-proof: ${results.length} cases, all as declared`);
if (keep) console.error(`gate-proof: files kept in ${work}`);
else rmSync(work, { recursive: true, force: true });
