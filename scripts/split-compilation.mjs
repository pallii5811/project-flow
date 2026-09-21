/**
 * Cuts one long delivery (a whole vertical mini-series glued into one file)
 * into per-episode masters that `scripts/ingest-series.mjs` can publish.
 *
 * Two steps, with a person in between:
 *
 *   node scripts/split-compilation.mjs propose <slug> --input <file> [--out <dir>]
 *
 *     Measures the file once with ffmpeg (black, silence, picture cuts,
 *     brightness, black bars) and proposes where each episode starts. Writes,
 *     under --out (default .split-work/<slug>/):
 *       <slug>.cuts.json     one entry per cut: the frame, the evidence, how sure
 *       contact/cut-NN.jpg   last frame before and first frame after each cut,
 *                            with their time and frame number
 *       report.txt           the same, in plain words, cuts to look at first
 *     Nothing is split and nothing is published.
 *
 *   node scripts/split-compilation.mjs split <slug> --input <file>
 *                                        [--cuts <file>] [--episodes 3,4]
 *
 *     Splits on a CONFIRMED cuts file (default content/series/<slug>/cuts.json:
 *     committed, "confirmed": true), frame-accurately, into the masters
 *     series.json names, each re-encoded to a high-quality intermediate
 *     (never a stream copy, which can only cut on a keyframe). Next to each
 *     master it writes <master>.source.json: which frames of which file it is.
 *     Refuses unless series.json says the studio allows splitting
 *     (splitAllowed + splitPermission, docs/content-operations.md).
 *
 *   node scripts/split-compilation.mjs provenance <slug> --input <file> [--cuts <file>]
 *
 *     Writes only the .source.json files, without encoding: enough for a
 *     later run to know which episodes are already published.
 *
 * Common flags: --delivery-root <dir> (default content/series), --sha256 <hex>
 * (the file's hash when the caller already computed it).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
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

import { parseDetections, QUALITY_RULES } from "./lib/media-gate.mjs";
import { checkEpisodeNumbers, isInside, isSlug } from "./lib/delivery-rules.mjs";
import {
  SPLIT_RULES,
  SPLIT_VERSION,
  buildCandidates,
  buildCutsFile,
  checkCutsFile,
  checkSplitPermission,
  chooseCuts,
  parseCropDetect,
  parseFrameRate,
  parseLumaSeries,
  parseSceneChanges,
  pillarboxVerdict,
  splitIdentity,
  timecode,
} from "./lib/split-rules.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const [command, slug] = args;

function die(message) {
  console.error(`split-compilation: ${message}`);
  process.exit(1);
}

function flag(name) {
  const at = args.indexOf(name);
  if (at === -1) return null;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) die(`${name} needs a value`);
  return value;
}

function run(commandName, commandArgs, options = {}) {
  const result = spawnSync(commandName, commandArgs, {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    ...options,
  });
  if (result.error) die(`${commandName} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    die(`${commandName} exited with ${result.status}\n${(result.stderr ?? "").slice(-2000)}`);
  }
  return result;
}

/** Streamed: a compilation is often larger than a buffer Node will read in one go. */
async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk);
  return hash.digest("hex");
}

function probe(path) {
  const { stdout } = run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=index,codec_type,width,height,r_frame_rate,avg_frame_rate,nb_frames:stream_side_data=rotation:stream_tags=rotate:format=duration,size",
    "-of",
    "json",
    path,
  ]);
  const data = JSON.parse(stdout);
  const video = data.streams.find((stream) => stream.codec_type === "video");
  if (!video) die(`${path} has no video stream`);
  let rotation = 0;
  for (const entry of video.side_data_list ?? []) {
    if (Number.isFinite(Number(entry.rotation))) rotation = Number(entry.rotation);
  }
  const turned = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const fps = parseFrameRate(video.r_frame_rate);
  const averageFps = parseFrameRate(video.avg_frame_rate);
  if (!fps) die(`${path}: unreadable frame rate ${video.r_frame_rate}`);
  // Frames in the video stream, not the container's duration: the sound often
  // runs a few milliseconds longer, and an episode may not end past the last frame.
  let frames = Number(video.nb_frames);
  if (!Number.isInteger(frames) || frames <= 0) frames = countFrames(path);
  return {
    frames,
    // As shown: ffmpeg applies the rotation flag when it decodes.
    width: turned ? video.height : video.width,
    height: turned ? video.width : video.height,
    frameRate: video.r_frame_rate,
    fps,
    variableFrameRate: averageFps !== null && Math.abs(averageFps - fps) / fps > 0.01,
    durationMs: Math.round(Number(data.format.duration) * 1000),
    bytes: Number(data.format.size),
    audioStreams: data.streams.filter((stream) => stream.codec_type === "audio").length,
  };
}

function readDelivery(root, { allowEmptyEpisodes = false } = {}) {
  if (!slug || !isSlug(slug)) die(`"${slug ?? ""}" is not a series slug`);
  const dir = join(root, slug);
  const file = join(dir, "series.json");
  if (!existsSync(file)) die(`${file} does not exist: write series.json (with every episode) before splitting`);
  let delivery;
  try {
    delivery = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    die(`${file} is not readable JSON: ${error.message}`);
  }
  if (!Array.isArray(delivery.episodes) || (!allowEmptyEpisodes && delivery.episodes.length === 0)) {
    die("series.json lists no episodes");
  }
  const numbering = checkEpisodeNumbers(delivery.episodes ?? []);
  if (numbering.length > 0) die(numbering.map((entry) => `[${entry.code}] ${entry.message}`).join("; "));
  const range = delivery.episodeDurationMs ?? {};
  return {
    dir,
    file,
    delivery,
    episodes: [...(delivery.episodes ?? [])].sort((a, b) => a.episodeNumber - b.episodeNumber),
    minMs: Number.isFinite(range.min) ? range.min : QUALITY_RULES.durationMinMs,
    maxMs: Number.isFinite(range.max) ? range.max : QUALITY_RULES.durationMaxMs,
  };
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".m4v", ".webm", ".ts", ".mpg", ".mpeg", ".avi"]);

/** The delivered file. A folder (what the downloader writes) must hold exactly one video. */
function inputPath() {
  const raw = flag("--input");
  if (!raw) die("--input <file> is required");
  const path = resolve(raw);
  if (!existsSync(path)) die(`${path} does not exist`);
  if (!statSync(path).isDirectory()) return path;
  const videos = readdirSync(path)
    .filter((name) => VIDEO_EXTENSIONS.has(name.slice(name.lastIndexOf(".")).toLowerCase()))
    .map((name) => join(path, name));
  if (videos.length === 0) die(`${path} holds no video file`);
  if (videos.length > 1) {
    die(
      `${path} holds ${videos.length} video files; a compilation is one file: ${videos.map((file) => basename(file)).join(", ")}`,
    );
  }
  return videos[0];
}

// --- propose ---------------------------------------------------------------

/** One ffmpeg pass: everything the proposal reads. */
function analyse(input, workDir, audioIndex) {
  mkdirSync(workDir, { recursive: true });
  const lumaFile = "luma.txt";
  rmSync(join(workDir, lumaFile), { force: true });
  // Black bars are measured on the full picture, once a second; everything
  // else on a small copy of every frame, which is what makes one pass cheap.
  const graph = [
    "[0:v:0]split[full][s2]",
    `[full]scale=270:-2,scdet=threshold=${SPLIT_RULES.sceneThreshold},` +
      `blackdetect=d=${SPLIT_RULES.blackMinSeconds}:pix_th=0.10,` +
      `signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=${lumaFile}[vo]`,
    "[s2]fps=1,cropdetect=limit=24:round=2:reset=0,nullsink",
  ];
  const maps = ["-map", "[vo]"];
  if (audioIndex !== null) {
    graph.push(
      `[0:a:${audioIndex}]silencedetect=n=${SPLIT_RULES.silenceNoiseDb}dB:d=${SPLIT_RULES.silenceMinSeconds}[ao]`,
    );
    maps.push("-map", "[ao]");
  }
  // cwd = the work folder: the brightness file is named relative to it, so no
  // drive letter ever has to be escaped inside a filter argument.
  const result = run(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", input, "-filter_complex", graph.join(";"), ...maps, "-f", "null", "-"],
    { cwd: workDir },
  );
  const text = result.stderr ?? "";
  const detections = parseDetections(text);
  return {
    black: detections.black,
    silence: detections.silence,
    scenes: parseSceneChanges(text),
    crop: parseCropDetect(text),
    luma: parseLumaSeries(readFileSync(join(workDir, lumaFile), "utf8")),
  };
}

let drawtextState;
/** A font file for the labels, copied next to the sheets; null when there is none. */
function labelFont(workDir) {
  if (drawtextState !== undefined) return drawtextState;
  const filters = run("ffmpeg", ["-hide_banner", "-filters"]).stdout;
  if (!/\sdrawtext\s/.test(filters)) {
    drawtextState = null;
    return null;
  }
  const candidates = [
    process.env.FLOW_LABEL_FONT,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "C:/Windows/Fonts/arial.ttf",
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    drawtextState = null;
    return null;
  }
  copyFileSync(found, join(workDir, "label-font.ttf"));
  drawtextState = "label-font.ttf";
  return drawtextState;
}

/**
 * The last frame of one episode next to the first frame of the next, each
 * with its time and frame number, and a line saying how sure the cut is.
 * Frames are picked by number: a seek half a frame before frame N lands on N.
 */
function contactSheet(input, fps, cut, index, workDir, sheetPath) {
  const font = labelFont(workDir);
  const before = cut.frame - 1;
  const after = cut.frame;
  const seek = (frame) => String(Math.max(0, (frame - 0.5) / fps));
  // Text goes in bands around the pictures, never over them: a vertical frame
  // at this height is 360 px wide, and the frame itself is what must be seen.
  const text = (name, value) => {
    writeFileSync(join(workDir, name), value);
    return name;
  };
  const draw = (file, y, size, color = "white") =>
    font ? `,drawtext=fontfile=${font}:textfile=${file}:x=12:y=${y}:fontsize=${size}:fontcolor=${color}` : "";
  const why = cut.why.length > 64 ? `${cut.why.slice(0, 61)}...` : cut.why;
  const verdictColor = cut.confidence === "high" ? "0x8fe08f" : "0xffc857";
  const graph = [
    `[0:v]scale=-2:640,setsar=1,pad=iw+6:ih+72:0:72:0x202020` +
      `${draw(text("a1.txt", `episode ${index + 1} ends`), 10, 22)}` +
      `${draw(text("a2.txt", `${timecode(before / fps)}  frame ${before}`), 40, 20, "0xcfcfcf")}[a]`,
    `[1:v]scale=-2:640,setsar=1,pad=iw:ih+72:0:72:0x202020` +
      `${draw(text("b1.txt", `episode ${index + 2} starts`), 10, 22)}` +
      `${draw(text("b2.txt", `${timecode(after / fps)}  frame ${after}`), 40, 20, "0xcfcfcf")}[b]`,
    `[a][b]hstack=inputs=2,pad=iw:ih+72:0:0:0x202020` +
      `${draw(text("c1.txt", `cut ${index + 1}  ${cut.confidence.toUpperCase()}`), "h-64", 22, verdictColor)}` +
      `${draw(text("c2.txt", why), "h-34", 18, "0xcfcfcf")}`,
  ].join(";");
  run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      seek(before),
      "-i",
      input,
      "-ss",
      seek(after),
      "-i",
      input,
      "-filter_complex",
      graph,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      sheetPath,
    ],
    { cwd: workDir },
  );
  return Boolean(font);
}

async function propose() {
  const root = resolve(flag("--delivery-root") ?? join(repoRoot, "content", "series"));
  const { file: deliveryFile, delivery, episodes, minMs, maxMs } = readDelivery(root, { allowEmptyEpisodes: true });
  const input = inputPath();
  const out = resolve(flag("--out") ?? join(repoRoot, ".split-work", slug));
  const workDir = join(out, "work");
  mkdirSync(join(out, "contact"), { recursive: true });

  const started = Date.now();
  const info = probe(input);
  const sha256 = flag("--sha256") ?? (await sha256File(input));
  const audioIndex =
    info.audioStreams === 0 ? null : Number.isInteger(episodes[0]?.audioStream) ? episodes[0].audioStream : 0;
  console.error(
    `split-compilation: measuring ${basename(input)} (${info.width}x${info.height}, ${info.frameRate} fps, ${timecode(info.durationMs / 1000)})`,
  );
  const measured = analyse(input, workDir, audioIndex);
  const analysedIn = (Date.now() - started) / 1000;

  const durationSeconds = info.frames / info.fps;
  const candidates = buildCandidates({
    fps: info.fps,
    durationSeconds,
    black: measured.black,
    silence: measured.silence,
    scenes: measured.scenes,
    luma: measured.luma,
  });
  // Drop leading dead air (silent or black leader, docs/content-operations.md §7)
  let leaderEndSeconds = 0;
  const leadingSilence = measured.silence.find((s) => s.start <= 0.2 && s.end !== null);
  if (
    leadingSilence &&
    (leadingSilence.duration ?? leadingSilence.end - leadingSilence.start) >= QUALITY_RULES.silenceOpeningMaxSeconds
  ) {
    leaderEndSeconds = Math.max(leaderEndSeconds, leadingSilence.end);
  }
  const leadingBlack = measured.black.find((b) => b.start <= 0.2 && b.end !== null);
  if (
    leadingBlack &&
    (leadingBlack.duration ?? leadingBlack.end - leadingBlack.start) >= QUALITY_RULES.blackOpeningMaxSeconds
  ) {
    leaderEndSeconds = Math.max(leaderEndSeconds, leadingBlack.end);
  }

  let startFrame = 0;
  if (leaderEndSeconds > 0) {
    const nearbyScene = measured.scenes.find((s) => Math.abs(s.time - leaderEndSeconds) <= 1.5);
    const snapSeconds = nearbyScene ? nearbyScene.time : leaderEndSeconds;
    startFrame = Math.round(snapSeconds * info.fps);
    console.error(
      `split-compilation: dropping ${snapSeconds.toFixed(2)} s leader (startFrame: ${startFrame})`,
    );
  }

  // Drop trailing silence or black
  let trailerStartSeconds = durationSeconds;
  const trailingSilence = measured.silence.find(
    (s) => (s.end === null || s.end >= durationSeconds - 0.2) && s.start < durationSeconds,
  );
  if (
    trailingSilence &&
    (trailingSilence.duration ?? durationSeconds - trailingSilence.start) >= QUALITY_RULES.silenceOpeningMaxSeconds
  ) {
    trailerStartSeconds = Math.min(trailerStartSeconds, trailingSilence.start);
  }
  const trailingBlack = measured.black.find(
    (b) => (b.end === null || b.end >= durationSeconds - 0.2) && b.start < durationSeconds,
  );
  if (
    trailingBlack &&
    (trailingBlack.duration ?? durationSeconds - trailingBlack.start) >= QUALITY_RULES.blackOpeningMaxSeconds
  ) {
    trailerStartSeconds = Math.min(trailerStartSeconds, trailingBlack.start);
  }

  let endFrame = info.frames;
  if (trailerStartSeconds < durationSeconds) {
    const nearbyScene = measured.scenes.find((s) => Math.abs(s.time - trailerStartSeconds) <= 1.5);
    const snapSeconds = nearbyScene ? nearbyScene.time : trailerStartSeconds;
    endFrame = Math.round(snapSeconds * info.fps);
    console.error(
      `split-compilation: dropping ${(durationSeconds - snapSeconds).toFixed(2)} s trailer (endFrame: ${endFrame})`,
    );
  }

  const choice = chooseCuts({
    fps: info.fps,
    durationSeconds,
    candidates,
    startFrame,
    endFrame,
    episodes: episodes.length > 0 ? episodes.length : null,
    minSeconds: minMs / 1000,
    maxSeconds: maxMs / 1000,
  });
  if (!choice.ok) die(`no proposal: ${choice.reason}`);

  const episodeCount = choice.cuts.length + 1;
  if (episodes.length === 0) {
    delivery.episodes = Array.from({ length: episodeCount }, (_, i) => ({
      episodeNumber: i + 1,
      master: `masters/episode-${i + 1}.mp4`,
      title: `Episode ${i + 1}`,
    }));
    writeFileSync(deliveryFile, `${JSON.stringify(delivery, null, 2)}\n`, "utf8");
    episodes.push(...delivery.episodes);
    console.error(`split-compilation: auto-populated ${episodeCount} episodes in ${basename(deliveryFile)}`);
  }

  const pillarbox = pillarboxVerdict(measured.crop, info.width, info.height);
  const notes = checkSplitPermission(delivery).map(
    (problem) => `the split will be refused until this is fixed: [${problem.code}] ${problem.message}`,
  );
  if (info.variableFrameRate) {
    notes.push("variable frame rate: frame numbers are approximate, check every cut by eye");
  }
  if (audioIndex === null) notes.push("the file has no audio: silence could not be used");
  if (pillarbox.pillarboxed) notes.push(`PILLARBOX: ${pillarbox.message}`);
  else if (info.width > info.height) notes.push(`the file is horizontal (${info.width}x${info.height}): it is not a vertical master`);

  let labelled = true;
  choice.cuts.forEach((cut, index) => {
    const name = `cut-${String(index + 1).padStart(2, "0")}.jpg`;
    labelled = contactSheet(input, info.fps, cut, index, workDir, join(out, "contact", name)) && labelled;
    cut.contactSheet = `contact/${name}`;
  });
  if (!labelled) notes.push("contact sheets carry no text (no drawtext or no font): read times and frames in the cuts file");

  const file = buildCutsFile({
    slug,
    source: {
      file: basename(input),
      sha256,
      bytes: info.bytes,
      durationMs: info.durationMs,
      frames: info.frames,
      frameRate: info.frameRate,
      width: info.width,
      height: info.height,
    },
    startFrame,
    endFrame,
    cuts: choice.cuts,
    episodes: episodes.length,
    crop: pillarbox.pillarboxed ? { ...pillarbox.crop, apply: false, lowerQuality: true } : null,
    notes,
  });
  const cutsPath = join(out, `${slug}.cuts.json`);
  writeFileSync(cutsPath, `${JSON.stringify(file, null, 2)}\n`);

  const byConfidence = (level) => choice.cuts.filter((cut) => cut.confidence === level).length;
  const lines = [
    `Proposed cuts for ${slug} — ${delivery.title ?? slug}`,
    `File: ${basename(input)}, ${info.width}x${info.height}, ${info.frameRate} fps, ${timecode(durationSeconds)}`,
    `sha256 ${sha256}`,
    `${episodes.length} episodes in series.json, ${choice.cuts.length} cuts proposed: ` +
      `${byConfidence("high")} sure, ${byConfidence("low")} to check, ${byConfidence("none")} with nothing to see`,
    `Measured in ${analysedIn.toFixed(0)} s.`,
    "",
    ...notes.map((note) => `NOTE: ${note}`),
    ...(notes.length ? [""] : []),
    "Look at the LOW and NONE cuts first. On each sheet the left frame must be the",
    "end of one episode and the right frame the start of the next.",
    "",
    ...choice.cuts.map((cut, index) => {
      const rivals = cut.rivals.length ? `; also possible: ${cut.rivals.map((rival) => rival.at).join(", ")}` : "";
      return `cut ${String(index + 1).padStart(2)}  ${cut.at}  frame ${cut.frame}  ${cut.confidence.toUpperCase().padEnd(4)}  ${cut.why}${rivals}  [${cut.contactSheet}]`;
    }),
    "",
    "To use the cuts: fix any wrong frame in the cuts file, set \"confirmed\": true,",
    `and commit it as content/series/${slug}/cuts.json.`,
  ];
  writeFileSync(join(out, "report.txt"), `${lines.join("\n")}\n`);
  rmSync(workDir, { recursive: true, force: true });
  console.error(lines.join("\n"));
  console.error(`\nsplit-compilation: proposal in ${out}`);
}

// --- split -----------------------------------------------------------------

function readCuts(path) {
  if (!existsSync(path)) {
    die(`${path} does not exist: run "propose", check the contact sheets, and commit the confirmed file there`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`${path} is not readable JSON: ${error.message}`);
    return null;
  }
}

function episodeFilter() {
  const raw = flag("--episodes");
  if (raw === null) return null;
  const numbers = new Set();
  for (const part of raw.split(",")) {
    const range = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!range) die(`--episodes "${raw}": use numbers and ranges, like 3,5-7`);
    const from = Number(range[1]);
    const to = Number(range[2] ?? range[1]);
    for (let n = from; n <= to; n += 1) numbers.add(n);
  }
  return numbers;
}

async function prepareSplit() {
  const root = resolve(flag("--delivery-root") ?? join(repoRoot, "content", "series"));
  const { dir, delivery, episodes, minMs, maxMs } = readDelivery(root);
  const permission = checkSplitPermission(delivery);
  const cutsPath = resolve(flag("--cuts") ?? join(dir, "cuts.json"));
  const cuts = readCuts(cutsPath);
  const input = inputPath();
  const sha256 = flag("--sha256") ?? (await sha256File(input));
  const checked = checkCutsFile(cuts, { episodes: episodes.length, minMs, maxMs, sourceSha256: sha256 });
  const problems = [...permission, ...checked.issues];
  if (problems.length > 0) {
    console.error(`split-compilation: REFUSED ${slug} — nothing was split`);
    for (const problem of problems) console.error(`    - [${problem.code}] ${problem.message}`);
    process.exit(1);
  }
  const fps = parseFrameRate(cuts.source.frameRate);
  const only = episodeFilter();
  const crop = cuts.crop && cuts.crop.apply === true ? cuts.crop : null;
  const jobs = [];
  for (const range of checked.episodes) {
    const episode = episodes[range.episodeNumber - 1];
    const master = resolve(dir, episode.master ?? "");
    if (typeof episode.master !== "string" || !isInside(join(dir, "masters"), master)) {
      die(`episode ${range.episodeNumber}: "master" must name a file under masters/, got ${String(episode.master)}`);
    }
    if (only && !only.has(range.episodeNumber)) continue;
    jobs.push({ range, master, episode });
  }
  if (crop) {
    console.error(
      `split-compilation: CROPPING to ${crop.w}x${crop.h} at ${crop.x},${crop.y} as the cuts file asks. ` +
        "LOWER QUALITY than a vertical master: the gate refuses it below 1080x1920 unless series.json declares allowBelow1080p.",
    );
  }
  const provenanceOf = (range, masterSha256) => ({
    splitVersion: SPLIT_VERSION,
    identity: splitIdentity({
      sourceSha256: sha256,
      startFrame: range.startFrame,
      endFrame: range.endFrame,
      frameRate: cuts.source.frameRate,
      crop,
    }),
    source: { file: cuts.source.file, sha256 },
    startFrame: range.startFrame,
    endFrame: range.endFrame,
    frameRate: cuts.source.frameRate,
    start: timecode(range.startFrame / fps),
    end: timecode(range.endFrame / fps),
    cropped: crop ? { w: crop.w, h: crop.h, x: crop.x, y: crop.y, lowerQuality: true } : null,
    masterSha256,
  });
  return { input, fps, crop, jobs, provenanceOf };
}

function writeProvenance(master, provenance) {
  mkdirSync(dirname(master), { recursive: true });
  writeFileSync(`${master}.source.json`, `${JSON.stringify(provenance, null, 2)}\n`);
}

/** Frames actually in a written master, counted from its packets. */
function countFrames(path) {
  const { stdout } = run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-count_packets",
    "-show_entries",
    "stream=nb_read_packets",
    "-of",
    "csv=p=0",
    path,
  ]);
  return Number(stdout.trim());
}

async function split() {
  const { input, fps, crop, jobs, provenanceOf } = await prepareSplit();
  const started = Date.now();
  let seconds = 0;
  for (const { range, master, episode } of jobs) {
    const frames = range.endFrame - range.startFrame;
    const partial = `${master}.partial.mp4`;
    mkdirSync(dirname(master), { recursive: true });
    // Seek to two seconds before the cut (the decoder starts from the keyframe
    // before that, whatever the GOP), then keep exactly the frames of this
    // episode by their time: half a frame of margin on each side makes the
    // bounds immune to rounding. The sound is cut at the same instants.
    const seek = Math.max(0, range.startFrame / fps - 2);
    const from = range.startFrame / fps - seek;
    const to = range.endFrame / fps - seek;
    const half = 0.5 / fps;
    const picture =
      `trim=start=${Math.max(0, from - half).toFixed(6)}:end=${(to - half).toFixed(6)},setpts=PTS-STARTPTS` +
      (crop ? `,crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : "");
    const sound = `atrim=start=${from.toFixed(6)}:end=${to.toFixed(6)},asetpts=PTS-STARTPTS`;
    run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      seek.toFixed(6),
      "-i",
      input,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      picture,
      "-af",
      sound,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "16",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "flac",
      "-movflags",
      "+faststart",
      partial,
    ]);
    const written = countFrames(partial);
    if (written !== frames) {
      rmSync(partial, { force: true });
      die(`episode ${range.episodeNumber}: wrote ${written} frames, the cuts say ${frames}; nothing kept`);
    }
    rmSync(master, { force: true });
    renameSync(partial, master);
    const masterSha256 = await sha256File(master);
    writeProvenance(master, provenanceOf(range, masterSha256));
    seconds += frames / fps;
    console.error(
      `split-compilation: episode ${episode.episodeNumber} → ${basename(master)}, ` +
        `${timecode(range.startFrame / fps)}–${timecode(range.endFrame / fps)} (${frames} frames)`,
    );
  }
  const took = (Date.now() - started) / 1000;
  console.error(
    `split-compilation: ${jobs.length} episode(s), ${seconds.toFixed(1)} s of video in ${took.toFixed(1)} s` +
      (seconds > 0 ? ` (${(took / seconds).toFixed(2)} s per second of video)` : ""),
  );
}

async function provenanceOnly() {
  const { jobs, provenanceOf } = await prepareSplit();
  for (const { range, master } of jobs) {
    const existing = `${master}.source.json`;
    let masterSha256 = null;
    // A master already split for exactly these frames keeps its hash.
    if (existsSync(existing) && existsSync(master)) {
      try {
        const previous = JSON.parse(readFileSync(existing, "utf8"));
        const next = provenanceOf(range, null);
        if (previous.identity === next.identity) masterSha256 = previous.masterSha256 ?? null;
      } catch {
        masterSha256 = null;
      }
    }
    if (masterSha256 === null && existsSync(master)) rmSync(master, { force: true });
    writeProvenance(master, provenanceOf(range, masterSha256));
  }
  console.error(`split-compilation: provenance written for ${jobs.length} episode(s), nothing encoded`);
}

if (command === "propose") await propose();
else if (command === "split") await split();
else if (command === "provenance") await provenanceOnly();
else {
  die(
    "usage: node scripts/split-compilation.mjs propose|split|provenance <slug> --input <file> [--out dir] [--cuts file] [--episodes 1,3-5] [--delivery-root dir]",
  );
}
