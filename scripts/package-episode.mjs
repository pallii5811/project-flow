/**
 * Packages one episode master into adaptive HLS for zero-egress hosting, and
 * refuses it when it would reach a viewer as a defect.
 *
 *   node scripts/package-episode.mjs <master.mp4> <output-dir> [options]
 *
 *   --allow-below-1080p      stand-in packs only (docs/content-operations.md)
 *   --audio-stream <n>       which audio stream carries the dialogue
 *   --duration-min-ms <n>    episode length range this series declares
 *   --duration-max-ms <n>
 *   --no-poster              the caller derives its own poster from the master
 *   --label <text>           how the episode is named in the refusal report
 *
 * Output:
 *   master.m3u8             adaptive playlist (what the catalog points to)
 *   v0/ v1/ …               one rendition per rung: index.m3u8, init.mp4, seg_NNN.m4s
 *   poster.jpg              720 px wide still at 1 s (unless --no-poster)
 *   manifest.json           MEASURED facts: duration, rungs, bytes, real
 *                           bitrates, loudness before and after, and the
 *                           options the gate judged with (ingest's resume key)
 *
 * Rules (docs/standard.md, docs/business-model.md, docs/content-operations.md):
 *   - vertical only: aspect between 0.45 and 0.65, as the catalog validator;
 *   - a producer master must be at least 1080×1920 (curation gate), unless
 *     --allow-below-1080p is passed for stand-in packs;
 *   - exactly one audio stream, or --audio-stream: the second stream of a
 *     delivery is usually music and effects, and shipping it loses the words;
 *   - audio normalised to −16 LUFS / −1.5 dBTP (EBU R128, two-pass loudnorm),
 *     and the result MEASURED on the packaged audio, not assumed;
 *   - no black, frozen or silent opening: the hook is the product; after the
 *     opening only a still longer than any shot (10 s) is refused, so fades,
 *     end cards and freeze-frame endings pass;
 *   - the shape is the one the viewer sees: a rotation flag is applied before
 *     the vertical check, and the recorded size is measured on the top rung;
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

import {
  QUALITY_RULES,
  checkMasterShape,
  checkPicture,
  checkPublishedLoudness,
  checkSilence,
  chooseAudioStream,
  displayDimensions,
  formatIssues,
  parseDetections,
  parseEbur128Summary,
  parseLoudnormJson,
} from "./lib/media-gate.mjs";

const SEGMENT_SECONDS = 2;
const MAX_MB_PER_MINUTE_LOWEST = 5;
/** Bumped when a rule changes, so ingest re-runs episodes packaged under the old one. */
const GATE_VERSION = 3;

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

/** The gate refused the episode: one block, the episode named, every reason. */
function refuse(label, issues) {
  console.error(`package-episode: REFUSED ${label}`);
  console.error(formatIssues(label, issues));
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

/** ffmpeg writes its measurements to stderr; a non-zero exit is still a failure. */
function runCapturingStderr(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} exited with ${result.status}\n${(result.stderr ?? "").slice(-2000)}`);
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function directoryBytes(dir) {
  return readdirSync(dir).reduce((sum, name) => {
    const path = join(dir, name);
    const stats = statSync(path);
    return sum + (stats.isDirectory() ? directoryBytes(path) : stats.size);
  }, 0);
}

function flagValue(list, name) {
  const at = list.indexOf(name);
  if (at === -1) return null;
  const raw = list[at + 1];
  if (raw === undefined) fail(`${name} needs a value`);
  return raw;
}

function numberFlag(list, name) {
  const raw = flagValue(list, name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) fail(`${name} must be a number, got "${raw}"`);
  return value;
}

const args = process.argv.slice(2);
const allowBelow1080p = args.includes("--allow-below-1080p");
const writePoster = !args.includes("--no-poster");
const audioStreamFlag = numberFlag(args, "--audio-stream");
const durationMinMs = numberFlag(args, "--duration-min-ms");
const durationMaxMs = numberFlag(args, "--duration-max-ms");
const labelFlag = flagValue(args, "--label");

const FLAGS_WITH_VALUES = new Set([
  "--audio-stream",
  "--duration-min-ms",
  "--duration-max-ms",
  "--label",
]);
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg.startsWith("--")) {
    if (FLAGS_WITH_VALUES.has(arg)) i += 1;
    continue;
  }
  positional.push(arg);
}
const [inputArg, outputArg] = positional;
if (!inputArg || !outputArg) {
  fail(
    "usage: node scripts/package-episode.mjs <master> <output-dir> [--allow-below-1080p] [--audio-stream n] [--duration-min-ms n] [--duration-max-ms n] [--no-poster] [--label text]",
  );
}
const input = resolve(inputArg);
const output = resolve(outputArg);
const label = labelFlag ?? basename(input);

const probe = JSON.parse(
  run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=index,codec_type,codec_name,channels,width,height,r_frame_rate:stream_tags=language,rotate:stream_side_data=rotation:format=duration",
    "-of",
    "json",
    input,
  ]),
);
const video = probe.streams.find((stream) => stream.codec_type === "video");
const durationSeconds = Number(probe.format?.duration);
if (!video) {
  refuse(label, [{ code: "no_video", message: "the master has no video stream" }]);
}

// The picture as it is shown, after the rotation flag ffmpeg applies on decode.
const { width, height, rotation } = displayDimensions(video);
const [fpsNum, fpsDen] = String(video.r_frame_rate).split("/").map(Number);
const fps = fpsDen ? fpsNum / fpsDen : fpsNum;
const durationMs = Number.isFinite(durationSeconds)
  ? Math.round(durationSeconds * 1000)
  : NaN;

const shapeIssues = checkMasterShape(
  { width, height, fps, durationMs },
  {
    allowBelow1080p,
    durationMinMs: durationMinMs ?? undefined,
    durationMaxMs: durationMaxMs ?? undefined,
  },
);
const audioChoice = chooseAudioStream(probe.streams, audioStreamFlag);
const preIssues = [...shapeIssues, ...audioChoice.issues];
if (preIssues.length > 0) refuse(label, preIssues);

const audioIndex = audioChoice.index;

/**
 * One pass over the master measures everything the gate needs: black picture,
 * frozen picture, silence, and the loudness the second pass will correct.
 */
const firstPass = runCapturingStderr("ffmpeg", [
  "-hide_banner",
  "-nostats",
  "-i",
  input,
  "-map",
  "0:v:0",
  "-map",
  `0:a:${audioIndex}`,
  "-vf",
  `blackdetect=d=0.3:pix_th=0.10,freezedetect=n=-60dB:d=${QUALITY_RULES.freezeOpeningMaxSeconds}`,
  "-af",
  `silencedetect=n=-50dB:d=1,loudnorm=I=${QUALITY_RULES.targetLufs}:TP=-1.5:LRA=11:print_format=json`,
  "-f",
  "null",
  "-",
]);

const detections = parseDetections(firstPass);
const measuredInput = parseLoudnormJson(firstPass);
const mediaIssues = [
  ...checkPicture(detections, durationMs),
  ...checkSilence(detections, durationMs),
];
if (!measuredInput) {
  mediaIssues.push({
    code: "loudness_unmeasured",
    message: "ffmpeg did not report the loudness of the master: it cannot be normalised",
  });
}
if (mediaIssues.length > 0) refuse(label, mediaIssues);

const rungs = LADDER.filter((rung) => rung.height <= height);
if (rungs.length === 0) {
  refuse(label, [
    {
      code: "below_lowest_rung",
      message: `master height ${height} is below the lowest rung`,
    },
  ]);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (let i = 0; i < rungs.length; i += 1) mkdirSync(join(output, `v${i}`));

const split = `[0:v]split=${rungs.length}${rungs.map((_, i) => `[s${i}]`).join("")}`;
const scales = rungs.map(
  (rung, i) => `[s${i}]scale=w=-2:h=${rung.height}:flags=lanczos,setsar=1[o${i}]`,
);
/** Second loudnorm pass: the measurements of the first one, applied once, then split. */
const loudnorm =
  `[0:a:${audioIndex}]loudnorm=I=${QUALITY_RULES.targetLufs}:TP=-1.5:LRA=11:` +
  `measured_I=${measuredInput.inputI}:measured_TP=${measuredInput.inputTp}:` +
  `measured_LRA=${measuredInput.inputLra}:measured_thresh=${measuredInput.inputThresh}:` +
  `offset=${measuredInput.targetOffset}:linear=true,aresample=48000,` +
  `asplit=${rungs.length}${rungs.map((_, i) => `[a${i}]`).join("")}`;

const ffmpegArgs = [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-i",
  input,
  "-filter_complex",
  [split, ...scales, loudnorm].join(";"),
];
rungs.forEach((rung, i) => {
  ffmpegArgs.push("-map", `[o${i}]`, "-map", `[a${i}]`);
  ffmpegArgs.push(
    `-crf:v:${i}`,
    "23",
    `-maxrate:v:${i}`,
    `${rung.maxrateKbps}k`,
    `-bufsize:v:${i}`,
    `${rung.maxrateKbps * 2}k`,
    `-b:a:${i}`,
    `${rung.audioKbps}k`,
  );
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
  "-c:a",
  "aac",
  "-ac",
  "2",
);
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
  rungs.map((_, i) => `v:${i},a:${i}`).join(" "),
  "v%v/index.m3u8",
);
run("ffmpeg", ffmpegArgs, output);

if (writePoster) {
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
}

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
  return { segments: segmentUris.length, initUri: mapUri };
}

/** Width and height of a produced rendition, read from its init segment. */
function renditionSize(path) {
  const probed = JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:stream_side_data=rotation",
      "-of",
      "json",
      path,
    ]),
  );
  return displayDimensions(probed.streams?.[0]);
}

const measured = rungs.map((rung, i) => {
  const dir = join(output, `v${i}`);
  const { segments, initUri } = checkPlaylist(dir, `v${i}`);
  const bytes = directoryBytes(dir);
  const size = renditionSize(join(dir, initUri));
  return {
    name: `v${i}`,
    width: size.width,
    height: size.height,
    maxrateKbps: rung.maxrateKbps,
    audioKbps: rung.audioKbps,
    segments,
    bytes,
    averageKbps: Math.round((bytes * 8) / durationSeconds / 1000),
  };
});
if (!readdirSync(output).includes("master.m3u8")) fail("master.m3u8 was not written");

/**
 * What the viewer will receive, measured on the files produced: the top rung
 * must be vertical and no taller than the master. The catalog records these
 * numbers, not the ones read from the master's header.
 */
const top = measured[measured.length - 1];
const producedIssues = checkMasterShape(
  { width: top.width, height: top.height, fps, durationMs },
  { allowBelow1080p: true, durationMinMs: 0, durationMaxMs: Number.MAX_SAFE_INTEGER },
).filter((entry) => entry.code === "not_vertical" || entry.code === "unreadable_dimensions");
if (top.height > height) {
  producedIssues.push({
    code: "upscaled",
    message: `the top rendition is ${top.width}x${top.height}, taller than the ${width}x${height} master`,
  });
}
if (producedIssues.length > 0) refuse(label, producedIssues);

/**
 * The loudness of what will actually be served, read back from the packaged
 * rendition. A filter that was asked to normalise is not proof that it did.
 */
const publishedLoudness = parseEbur128Summary(
  runCapturingStderr("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-loglevel",
    "info",
    "-i",
    join(output, "v0", "index.m3u8"),
    "-af",
    "ebur128=peak=true",
    "-f",
    "null",
    "-",
  ]),
);
const loudnessIssues = checkPublishedLoudness(publishedLoudness);
if (loudnessIssues.length > 0) refuse(label, loudnessIssues);

const lowest = measured[0];
const mbPerMinuteLowest = Number(
  (((lowest.bytes / durationSeconds) * 60) / 1_000_000).toFixed(2),
);
if (mbPerMinuteLowest > MAX_MB_PER_MINUTE_LOWEST) {
  refuse(label, [
    {
      code: "too_many_bytes",
      message: `lowest rung costs ${mbPerMinuteLowest} MB per minute (max ${MAX_MB_PER_MINUTE_LOWEST})`,
    },
  ]);
}

const manifest = {
  schemaVersion: 2,
  gateVersion: GATE_VERSION,
  source: basename(input),
  sourceSha256: createHash("sha256").update(readFileSync(input)).digest("hex"),
  // What the gate was asked to judge with. Ingest compares it on the next run:
  // a corrected delivery (another audio stream, another length range) must be
  // judged again, not reused.
  gateOptions: {
    allowBelow1080p,
    audioStream: audioStreamFlag,
    durationMinMs,
    durationMaxMs,
  },
  durationMs,
  // Measured on the top rendition that will be served.
  width: top.width,
  height: top.height,
  master: { width, height, rotation },
  fps: Number(fps.toFixed(3)),
  hasAudio: true,
  audioStream: audioIndex,
  segmentSeconds: SEGMENT_SECONDS,
  renditions: measured,
  mbPerMinuteLowest,
  loudness: {
    targetLufs: QUALITY_RULES.targetLufs,
    deliveredLufs: measuredInput.inputI,
    deliveredTruePeakDb: measuredInput.inputTp,
    publishedLufs: publishedLoudness.integratedLufs,
    publishedTruePeakDb: publishedLoudness.truePeakDb,
    publishedRangeLu: publishedLoudness.loudnessRangeLu,
  },
  picture: {
    blackRanges: detections.black.length,
    freezeRanges: detections.freeze.length,
    silenceRanges: detections.silence.length,
  },
  ffmpeg: run("ffmpeg", ["-version"]).split(/\r?\n/)[0],
};
writeFileSync(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.error(
  `package-episode: ${label} → ${measured.length} rungs, ${manifest.durationMs} ms, ` +
    `${measuredInput.inputI} → ${publishedLoudness.integratedLufs} LUFS, ` +
    `lowest ${mbPerMinuteLowest} MB/min, total ${Math.round(directoryBytes(output) / 1024)} kB`,
);
