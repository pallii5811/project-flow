/**
 * Refuses an ffmpeg that cannot do what the pipeline needs, before anything
 * is downloaded or encoded.
 *
 *   node scripts/check-ffmpeg.mjs
 *
 * A build without libwebp writes no poster; one without scdet finds no
 * picture cut; one without ebur128 cannot read back the loudness it was asked
 * to set. Each of those fails much later, in a way that looks like a content
 * problem. Here it is one line, at minute one — which is the whole point of
 * pinning a build in the workflow (docs/cloud-ingest.md).
 */
import { spawnSync } from "node:child_process";

const FILTERS = [
  ["blackdetect", "black frames between episodes, and a black opening"],
  ["freezedetect", "a frozen opening or a frozen master"],
  ["silencedetect", "silence between episodes, and a silent opening"],
  ["scdet", "picture cuts, for the compilation splitter"],
  ["cropdetect", "a vertical picture pillarboxed in a 16:9 file"],
  ["signalstats", "brightness, to tell a fade to black from a cut"],
  ["loudnorm", "EBU R128 normalisation to -16 LUFS"],
  ["ebur128", "reading that loudness back from what will be served"],
  ["xfade", "the proof's synthetic compilation"],
  ["gblur", "the blurred fill of the link-preview card"],
];
const ENCODERS = [
  ["libx264", "the video renditions"],
  ["aac", "the audio of the renditions"],
  ["libwebp", "the feed poster"],
  ["mjpeg", "the link-preview card"],
  ["flac", "the audio of a master cut from a compilation"],
];
const OPTIONAL = [["drawtext", "the times written on the contact sheets (they still work without it)"]];

function run(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) {
    console.error(`check-ffmpeg: ffmpeg could not start: ${result.error.message}`);
    process.exit(1);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

const version = run(["-version"]).split(/\r?\n/)[0];
const probe = spawnSync("ffprobe", ["-version"], { encoding: "utf8" });
if (probe.status !== 0) {
  console.error("check-ffmpeg: ffprobe is not next to ffmpeg");
  process.exit(1);
}
const filters = run(["-filters"]);
const encoders = run(["-encoders"]);

const missing = [];
for (const [name, why] of FILTERS) if (!new RegExp(`\\s${name}\\s`).test(filters)) missing.push(`filter ${name} — ${why}`);
for (const [name, why] of ENCODERS) if (!new RegExp(`\\s${name}\\s`).test(encoders)) missing.push(`encoder ${name} — ${why}`);
const warnings = OPTIONAL.filter(([name]) => !new RegExp(`\\s${name}\\s`).test(filters));

console.error(`check-ffmpeg: ${version}`);
const major = Number(/version n?(\d+)/.exec(version)?.[1]);
if (Number.isFinite(major) && major < 6) {
  missing.push(`this is ffmpeg ${major}: the pipeline is measured on 6 and later (the workflow pins an 8 build)`);
}
for (const [name, why] of warnings) console.error(`check-ffmpeg: WARNING no ${name} — ${why}`);
if (missing.length > 0) {
  console.error("check-ffmpeg: this ffmpeg cannot run the pipeline:");
  for (const entry of missing) console.error(`  - ${entry}`);
  process.exit(1);
}
console.error(`check-ffmpeg: ${FILTERS.length} filters and ${ENCODERS.length} encoders present`);
