/**
 * Packages one episode master into adaptive HLS for zero-egress hosting.
 *
 *   node scripts/package-episode.mjs <master.mp4> <output-dir> [--allow-below-1080p]
 *
 * Output:
 *   master.m3u8             adaptive playlist (what the catalog points to)
 *   v0/ v1/ …               one rendition per rung: index.m3u8, init.mp4, seg_NNN.m4s
 *   poster.jpg              720 px wide still at 1 s
 *   manifest.json           MEASURED facts: duration, rungs, bytes, real bitrates
 *
 * Rules (docs/standard.md, docs/business-model.md):
 *   - vertical only: aspect between 0.45 and 0.65, as the catalog validator;
 *   - a producer master must be at least 1080×1920 (curation gate), unless
 *     --allow-below-1080p is passed for stand-in packs;
 *   - rungs never upscale the master;
 *   - 2-second segments with a keyframe exactly every 2 seconds, so any rung
 *     can switch at any segment and a swipe needs only a few seconds of data;
 *   - the lowest rung must cost at most 5 MB per watched minute, measured on
 *     the files produced — the script fails otherwise.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

const SEGMENT_SECONDS = 2;
const MAX_MB_PER_MINUTE_LOWEST = 5;
const ASPECT_MIN = 0.45;
const ASPECT_MAX = 0.65;

/** Vertical ladder: height, video cap, audio bitrate. */
const LADDER = [
  { height: 640, maxrateKbps: 600, audioKbps: 64 },
  { height: 960, maxrateKbps: 1400, audioKbps: 96 },
  { height: 1280, maxrateKbps: 2500, audioKbps: 128 },
  { height: 1920, maxrateKbps: 5000, audioKbps: 128 },
];

function fail(message) {
  console.error(`package-episode: ${message}`);
  process.exit(1);
}

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(
      `${command} exited with ${result.status}\n${(result.stderr ?? "").slice(-2000)}`,
    );
  }
  return result.stdout;
}

function directoryBytes(dir) {
  return readdirSync(dir).reduce((sum, name) => {
    const path = join(dir, name);
    const stats = statSync(path);
    return sum + (stats.isDirectory() ? directoryBytes(path) : stats.size);
  }, 0);
}

const args = process.argv.slice(2);
const allowBelow1080p = args.includes("--allow-below-1080p");
const [inputArg, outputArg] = args.filter((arg) => !arg.startsWith("--"));
if (!inputArg || !outputArg) {
  fail(
    "usage: node scripts/package-episode.mjs <master> <output-dir> [--allow-below-1080p]",
  );
}
const input = resolve(inputArg);
const output = resolve(outputArg);

const probe = JSON.parse(
  run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height,r_frame_rate:format=duration",
    "-of",
    "json",
    input,
  ]),
);
const video = probe.streams.find((stream) => stream.codec_type === "video");
const hasAudio = probe.streams.some((stream) => stream.codec_type === "audio");
const durationSeconds = Number(probe.format?.duration);
if (!video) fail("the master has no video stream");
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
  fail(`unreadable duration: ${probe.format?.duration}`);
}

const { width, height } = video;
const aspect = width / height;
if (!(aspect >= ASPECT_MIN && aspect <= ASPECT_MAX)) {
  fail(`not vertical: ${width}×${height} (aspect ${aspect.toFixed(3)})`);
}
if (height < 1920 && !allowBelow1080p) {
  fail(`master is ${width}×${height}; the curation gate requires at least 1080×1920`);
}

const [fpsNum, fpsDen] = String(video.r_frame_rate).split("/").map(Number);
const fps = fpsDen ? fpsNum / fpsDen : fpsNum;
if (!Number.isFinite(fps) || fps <= 0)
  fail(`unreadable frame rate: ${video.r_frame_rate}`);

const rungs = LADDER.filter((rung) => rung.height <= height);
if (rungs.length === 0) fail(`master height ${height} is below the lowest rung`);

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (let i = 0; i < rungs.length; i += 1) mkdirSync(join(output, `v${i}`));

const split = `[0:v]split=${rungs.length}${rungs.map((_, i) => `[s${i}]`).join("")}`;
const scales = rungs.map(
  (rung, i) => `[s${i}]scale=w=-2:h=${rung.height}:flags=lanczos,setsar=1[o${i}]`,
);
const ffmpegArgs = [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-i",
  input,
  "-filter_complex",
  [split, ...scales].join(";"),
];
rungs.forEach((rung, i) => {
  ffmpegArgs.push("-map", `[o${i}]`);
  if (hasAudio) ffmpegArgs.push("-map", "0:a:0");
  ffmpegArgs.push(
    `-crf:v:${i}`,
    "23",
    `-maxrate:v:${i}`,
    `${rung.maxrateKbps}k`,
    `-bufsize:v:${i}`,
    `${rung.maxrateKbps * 2}k`,
  );
  if (hasAudio) ffmpegArgs.push(`-b:a:${i}`, `${rung.audioKbps}k`);
});
ffmpegArgs.push(
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-profile:v",
  "high",
  "-pix_fmt",
  "yuv420p",
  "-force_key_frames",
  `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
  "-sc_threshold",
  "0",
);
if (hasAudio) ffmpegArgs.push("-c:a", "aac", "-ac", "2");
ffmpegArgs.push(
  "-f",
  "hls",
  "-hls_time",
  String(SEGMENT_SECONDS),
  "-hls_playlist_type",
  "vod",
  "-hls_segment_type",
  "fmp4",
  "-hls_flags",
  "independent_segments",
  "-hls_fmp4_init_filename",
  "init.mp4",
  // Relative, forward-slash paths with cwd = output: playlists must carry
  // URL paths, never Windows backslashes.
  "-hls_segment_filename",
  "v%v/seg_%03d.m4s",
  "-master_pl_name",
  "master.m3u8",
  "-var_stream_map",
  rungs.map((_, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`)).join(" "),
  "v%v/index.m3u8",
);
run("ffmpeg", ffmpegArgs, output);

run("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-ss",
  String(Math.min(1, durationSeconds / 2)),
  "-i",
  input,
  "-frames:v",
  "1",
  "-vf",
  "scale=720:-2",
  "-q:v",
  "3",
  join(output, "poster.jpg"),
]);

/** Every URI a playlist names must exist on disk — checked, not assumed. */
function checkPlaylist(dir, name) {
  const lines = readFileSync(join(dir, "index.m3u8"), "utf8").split(/\r?\n/);
  const mapUri = lines
    .map((line) => /^#EXT-X-MAP:URI="([^"]+)"/.exec(line)?.[1])
    .find(Boolean);
  const segmentUris = lines.filter((line) => line && !line.startsWith("#"));
  if (!mapUri) fail(`rendition ${name} has no init segment (EXT-X-MAP)`);
  if (segmentUris.length === 0) fail(`rendition ${name} lists no segments`);
  for (const uri of [mapUri, ...segmentUris]) {
    if (uri.includes("\\") || uri.includes(":"))
      fail(`rendition ${name} has a non-URL path: ${uri}`);
    try {
      statSync(join(dir, uri));
    } catch {
      fail(`rendition ${name} lists ${uri}, which does not exist`);
    }
  }
  return segmentUris.length;
}

const measured = rungs.map((rung, i) => {
  const dir = join(output, `v${i}`);
  const segments = checkPlaylist(dir, `v${i}`);
  const bytes = directoryBytes(dir);
  return {
    name: `v${i}`,
    height: rung.height,
    maxrateKbps: rung.maxrateKbps,
    audioKbps: hasAudio ? rung.audioKbps : null,
    segments,
    bytes,
    averageKbps: Math.round((bytes * 8) / durationSeconds / 1000),
  };
});
if (!readdirSync(output).includes("master.m3u8")) fail("master.m3u8 was not written");

const lowest = measured[0];
const mbPerMinuteLowest = Number(
  (((lowest.bytes / durationSeconds) * 60) / 1_000_000).toFixed(2),
);
if (mbPerMinuteLowest > MAX_MB_PER_MINUTE_LOWEST) {
  fail(
    `lowest rung costs ${mbPerMinuteLowest} MB per minute (max ${MAX_MB_PER_MINUTE_LOWEST})`,
  );
}

const manifest = {
  schemaVersion: 1,
  source: basename(input),
  sourceSha256: createHash("sha256").update(readFileSync(input)).digest("hex"),
  durationMs: Math.round(durationSeconds * 1000),
  width,
  height,
  fps: Number(fps.toFixed(3)),
  hasAudio,
  segmentSeconds: SEGMENT_SECONDS,
  renditions: measured,
  mbPerMinuteLowest,
  ffmpeg: run("ffmpeg", ["-version"]).split(/\r?\n/)[0],
};
writeFileSync(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.error(
  `package-episode: ${basename(input)} → ${measured.length} rungs, ` +
    `${manifest.durationMs} ms, lowest ${mbPerMinuteLowest} MB/min, ` +
    `total ${Math.round(directoryBytes(output) / 1024)} kB`,
);
