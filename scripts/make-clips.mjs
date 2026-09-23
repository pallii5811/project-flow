/**
 * A day of social clips for one series, from the episodes already published.
 *
 *   node scripts/make-clips.mjs signal-night                  # today's 10 clips
 *   node scripts/make-clips.mjs signal-night --days 7         # a week
 *   node scripts/make-clips.mjs signal-night --plan-only      # what it would cut, nothing rendered
 *
 * Cliffies has no advertising budget. Every competitor in this format grew the
 * same way — fifteen to forty vertical clips a day, on TikTok, YouTube Shorts,
 * Instagram and Facebook, each one ending on a link to a free episode. That is
 * the only channel the owner can afford, and it is work a person cannot do by
 * hand at that rate: finding the moment, cutting it, burning the subtitles,
 * writing the description, building the link, and remembering what was already
 * posted. This does all of it and leaves exactly one thing to a person —
 * pressing Post.
 *
 * What it will not do:
 *
 *   - clip a series whose licence does not say clips may be posted
 *     (`socialClipsAllowed` and `socialClipsPermission`, the same shape the
 *     compilation splitter demands before it cuts a file);
 *   - write a sentence nobody wrote. Every word under a clip is either the
 *     series' own metadata or a fixed fragment in `scripts/lib/clip-rules.mjs`.
 *     No audience number, no superlative, no model;
 *   - post anything. It writes files and a list; the accounts are the owner's.
 *
 * Everything it claims about a finished clip is measured on the finished clip:
 * its loudness read back with ebur128, its duration and size from the file,
 * and the text it burned in found by rendering the same subtitles over a flat
 * colour, so every drawn pixel can be located and checked against the area the
 * platforms' own interface leaves free.
 *
 * The decisions live in `scripts/lib/clip-rules.mjs` as pure functions
 * (test/clip-rules.test.ts); this file runs ffmpeg and writes what it found.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLIP_KINDS,
  CLIP_RULES,
  CLIP_RULES_VERSION,
  CLIP_THEME,
  CLIP_WEIGHTS,
  PLATFORMS,
  addDays,
  boundingBoxOfBright,
  buildAssScript,
  buildClipLink,
  checkClipPermission,
  clipCode,
  clipIdentity,
  contrastRatio,
  cuesForClip,
  describeClip,
  dropOverlapping,
  hashtagsFor,
  hookLineFor,
  insideSafeArea,
  parseEbur128Series,
  proposeMoments,
  relativeLuminance,
  safeArea,
  scheduleClips,
  spreadByEpisode,
  standInLabel,
  unionBox,
  withoutProduced,
} from "./lib/clip-rules.mjs";
import { parseEbur128Summary, parseDetections, parseLoudnormJson } from "./lib/media-gate.mjs";
import { parseSceneChanges } from "./lib/split-rules.mjs";
import { parseVttCues, srtToVtt } from "./lib/vtt.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function die(message) {
  console.error(`make-clips: ${message}`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* What was asked for                                                          */
/* -------------------------------------------------------------------------- */

const args = process.argv.slice(2);
/** Flags that stand alone; everything else named with -- takes the next word. */
const SWITCHES = new Set(["--plan-only", "--keep"]);

function flag(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) die(`${name} needs a value`);
  return value;
}
function wholeNumber(name, fallback) {
  const raw = flag(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) die(`${name} must be a whole number of at least 1, got "${raw}"`);
  return value;
}

/** The words that are not a flag and not a flag's value: the series slug. */
const positional = [];
for (let index = 0; index < args.length; index += 1) {
  const entry = args[index];
  if (entry.startsWith("--")) {
    if (!SWITCHES.has(entry)) index += 1;
    continue;
  }
  positional.push(entry);
}
if (positional.length !== 1) {
  die(
    "which series? node scripts/make-clips.mjs <slug> [--per-day 10] [--days 1] [--plan-only]" +
      (positional.length > 1 ? `\n  got ${positional.length} series names: ${positional.join(", ")}` : ""),
  );
}
const slug = positional[0];

const perDay = wholeNumber("--per-day", 10);
const days = wholeNumber("--days", 1);
const planOnly = args.includes("--plan-only");
const keepWork = args.includes("--keep");
const deliveryRoot = flag("--delivery-root", join(repoRoot, "content", "series"));
const manifestRoot = flag(
  "--manifest-root",
  join(repoRoot, "packages", "feed-domain", "src", "data", "generated"),
);
const outRoot = flag("--out", join(repoRoot, "clips", slug));
const fontsDirFlag = flag("--fonts-dir", null);
const startDate = flag("--start-date", new Date().toISOString().slice(0, 10));
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) die(`--start-date must be YYYY-MM-DD, got "${startDate}"`);

/** A day of one kind only — cliffhangers, say — when that is what is wanted. */
const onlyKind = flag("--kind", null);
if (onlyKind !== null && !CLIP_KINDS.includes(onlyKind)) {
  die(`--kind must be one of ${CLIP_KINDS.join(", ")}, got "${onlyKind}"`);
}

const requestedPlatforms = flag("--platforms", null);
const platforms = requestedPlatforms ? requestedPlatforms.split(",").map((entry) => entry.trim()) : Object.keys(PLATFORMS);
for (const platform of platforms) {
  if (!PLATFORMS[platform]) die(`unknown platform "${platform}": one of ${Object.keys(PLATFORMS).join(", ")}`);
}

/**
 * The address burned into every end card and carried by every link. It is not
 * a secret and it is not guessable: a clip that says the wrong address is a
 * clip thrown away, so the run stops instead of inventing one.
 */
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "");
if (siteUrl.length === 0) {
  die(
    "NEXT_PUBLIC_SITE_URL is not set: the end card and every link carry the site address, and it is not something to guess.\n" +
      "  NEXT_PUBLIC_SITE_URL=https://cliffies.example node scripts/make-clips.mjs " + slug,
  );
}
let siteHost;
try {
  const parsed = new URL(siteUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("not http(s)");
  siteHost = parsed.host;
} catch {
  die(`NEXT_PUBLIC_SITE_URL is not a URL: "${siteUrl}"`);
}

/* -------------------------------------------------------------------------- */
/* Running things                                                              */
/* -------------------------------------------------------------------------- */

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error) die(`${command} could not start: ${result.error.message}`);
  return result;
}

function ffmpeg(commandArgs, options = {}) {
  const result = run("ffmpeg", ["-hide_banner", "-nostats", "-y", ...commandArgs], options);
  if (result.status !== 0) {
    die(`ffmpeg exited with ${result.status}\n${(result.stderr ?? "").slice(-3000)}`);
  }
  return result;
}

/** ffmpeg run for what it prints, not for what it writes: a failure is the caller's to read. */
function ffmpegRead(commandArgs, options = {}) {
  const result = run("ffmpeg", ["-hide_banner", "-nostats", ...commandArgs], options);
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`, raw: result };
}

function ffprobeJson(commandArgs) {
  const result = run("ffprobe", ["-v", "error", "-of", "json", ...commandArgs]);
  if (result.status !== 0) die(`ffprobe exited with ${result.status}\n${(result.stderr ?? "").slice(-2000)}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    die(`ffprobe printed something that is not JSON: ${error.message}`);
    return null;
  }
}

/** Bytes of raw video frames, straight out of ffmpeg's stdout. */
function ffmpegFrames(commandArgs, options = {}) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-loglevel", "error", ...commandArgs], {
    maxBuffer: 1024 * 1024 * 1024,
    ...options,
  });
  if (result.error) die(`ffmpeg could not start: ${result.error.message}`);
  if (result.status !== 0) {
    die(`ffmpeg exited with ${result.status}\n${String(result.stderr ?? "").slice(-3000)}`);
  }
  return result.stdout;
}

/* -------------------------------------------------------------------------- */
/* What was published, and what was delivered                                  */
/* -------------------------------------------------------------------------- */

/**
 * The generated manifest module, read as the data it is. Ingest writes it with
 * JSON.stringify, so the object is everything between the assignment and the
 * final brace; anything else in the file is the comment that says not to edit
 * it by hand.
 */
function readManifest(seriesSlug) {
  const path = join(manifestRoot, `${seriesSlug}.ts`);
  if (!existsSync(path)) {
    die(
      `${path} does not exist: "${seriesSlug}" has not been ingested, so there is nothing published to clip.\n` +
        `  node scripts/ingest-series.mjs ${seriesSlug}`,
    );
  }
  const text = readFileSync(path, "utf8");
  const marker = /export const [A-Z0-9_]+: SeriesManifest = /.exec(text);
  const end = text.lastIndexOf("};");
  if (!marker || end === -1) die(`${path} is not a generated series manifest`);
  try {
    return JSON.parse(text.slice(marker.index + marker[0].length, end + 1));
  } catch (error) {
    die(`${path} could not be read as a manifest: ${error.message}`);
    return null;
  }
}

/** The delivery, for the masters the clips are cut from and the caption files. */
function readDelivery(seriesSlug) {
  const path = join(deliveryRoot, seriesSlug, "series.json");
  if (!existsSync(path)) die(`${path} does not exist: the masters a clip is cut from live next to it`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`${path} is not readable JSON: ${error.message}`);
    return null;
  }
}

/** The episode's subtitles, parsed. SRT is converted the way ingest converts it. */
function readCues(seriesSlug, episode) {
  const tracks = Array.isArray(episode.captions) ? episode.captions : [];
  const preferred = tracks.find((track) => track.default === true) ?? tracks[0];
  if (!preferred) return { cues: [], language: null, file: null };
  const path = join(deliveryRoot, seriesSlug, preferred.file);
  if (!existsSync(path)) return { cues: [], language: preferred.language, file: preferred.file, missing: true };
  const raw = readFileSync(path, "utf8");
  const text = path.toLowerCase().endsWith(".srt") ? srtToVtt(raw) : raw;
  const parsed = parseVttCues(text);
  return {
    cues: parsed.cues.filter((cue) => cue.text.trim().length > 0),
    language: preferred.language,
    file: preferred.file,
    errors: parsed.errors,
  };
}

/* -------------------------------------------------------------------------- */
/* Measuring an episode, once                                                  */
/* -------------------------------------------------------------------------- */

const analysisDir = join(outRoot, "analysis");
const workDir = join(outRoot, "work");
const videoDir = join(outRoot, "video");
const framesDir = join(outRoot, "frames");

/**
 * One ffmpeg pass over an episode: where the picture cuts, where it is black
 * or frozen, where the sound stops, and how loud it is ten times a second.
 * Cached beside the clips and keyed by the master's size and time, because
 * this is the slow half and nothing about an unchanged master changes.
 */
function analyseEpisode(masterPath, episodeNumber) {
  const stat = statSync(masterPath);
  const cachePath = join(analysisDir, `episode-${episodeNumber}.json`);
  const key = `${basename(masterPath)}:${stat.size}:${Math.round(stat.mtimeMs)}:${CLIP_RULES_VERSION}`;
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8"));
      if (cached.key === key) return cached;
    } catch {
      // A corrupt cache is not a reason to stop: measure again.
    }
  }

  const r128Path = join(workDir, `r128-${episodeNumber}.txt`);
  const graph = [
    // Picture cuts are looked for on a small copy: scdet compares frames, and a
    // 270-wide one finds the same cuts for a fraction of the work.
    `[0:v]scale=270:-2,scdet=threshold=8,` +
      `blackdetect=d=0.05:pix_th=0.10,` +
      `freezedetect=n=-60dB:d=${CLIP_RULES.endCardMinSeconds}[vo]`,
    `[0:a:0]silencedetect=n=-45dB:d=0.3,ebur128=metadata=1,` +
      `ametadata=mode=print:key=lavfi.r128.M:file=${basename(r128Path)}[ao]`,
  ];
  const result = ffmpegRead(
    ["-loglevel", "info", "-i", masterPath, "-filter_complex", graph.join(";"), "-map", "[vo]", "-map", "[ao]", "-f", "null", "-"],
    { cwd: workDir },
  );
  if (!result.ok) die(`episode ${episodeNumber} could not be measured\n${result.output.slice(-3000)}`);

  const r128 = existsSync(r128Path) ? readFileSync(r128Path, "utf8") : "";
  const analysis = {
    key,
    scenes: parseSceneChanges(result.output),
    detections: parseDetections(result.output),
    loudness: parseEbur128Series(r128),
  };
  mkdirSync(analysisDir, { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(analysis, null, 2)}\n`);
  return analysis;
}

/* -------------------------------------------------------------------------- */
/* The font                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Families to draw a clip with, best first. The app's own type (Manrope and
 * Syne) is in the repository as woff2 only, which the FreeType inside ffmpeg
 * cannot open — see docs/clips.md, "What this cannot do". So a clip uses a
 * grotesque from the machine, and which one it really got is READ BACK from
 * libass instead of assumed: a silent fallback to a serif is the kind of
 * defect nobody sees until it is posted.
 */
const FONT_PREFERENCE = [
  "Inter",
  "Manrope",
  "Segoe UI",
  "Helvetica Neue",
  "Arial",
  "DejaVu Sans",
  "Liberation Sans",
  "Noto Sans",
];

/** libass prints `fontselect: (family, weight, italic) -> file, index, name`. */
function resolvedFontFrom(output) {
  const match = /fontselect:\s*\(([^,]+),\s*\d+,\s*\d+\)\s*->\s*([^,\n]+)/.exec(output);
  if (!match) return null;
  return { asked: match[1].trim(), got: match[2].trim() };
}

/**
 * Asks libass to draw one word in each candidate family and keeps the first it
 * does not have to substitute for.
 */
function chooseFont(fontsDir) {
  mkdirSync(workDir, { recursive: true });
  const tried = [];
  for (const family of FONT_PREFERENCE) {
    const probe = [
      "[Script Info]",
      "ScriptType: v4.00+",
      "PlayResX: 320",
      "PlayResY: 200",
      "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Alignment, Encoding",
      `Style: Probe,${family},48,&H00FFFFFF,0,5,1`,
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:00.00,0:00:01.00,Probe,,0,0,0,,Cliffies",
      "",
    ].join("\n");
    const probePath = join(workDir, "font-probe.ass");
    writeFileSync(probePath, probe);
    const filter = fontsDir
      ? `ass=font-probe.ass:fontsdir=${basename(fontsDir)}`
      : "ass=font-probe.ass";
    const result = ffmpegRead(
      ["-loglevel", "verbose", "-f", "lavfi", "-i", "color=c=black:s=320x200:r=1:d=1", "-vf", filter, "-frames:v", "1", "-f", "null", "-"],
      { cwd: workDir },
    );
    const resolved = resolvedFontFrom(result.output);
    tried.push(`${family} -> ${resolved ? resolved.got : "no answer"}`);
    if (!resolved) continue;
    // A substitution shows up as a file name with nothing of the family in it.
    const wanted = family.replace(/\s+/g, "").toLowerCase();
    const got = resolved.got.replace(/[\s-]+/g, "").toLowerCase();
    if (got.includes(wanted)) return { family, resolvedAs: resolved.got, tried };
  }
  die(
    `none of the families a clip may be drawn with is on this machine.\n` +
      `  tried: ${tried.join(", ")}\n` +
      `  install one of ${FONT_PREFERENCE.join(", ")}, or pass --fonts-dir with a folder holding a .ttf or .otf`,
  );
  return null;
}

/* -------------------------------------------------------------------------- */
/* Rendering one clip                                                          */
/* -------------------------------------------------------------------------- */

/** The mask of one instant is found on a tenth-of-a-second grid: cues last longer. */
const MASK_FPS = 10;
/** The flat colour the text is drawn over to be found: nothing else is this green. */
const PROBE_BACKGROUND = { r: 0, g: 255, b: 0 };

/** Pixels that are not the probe's background: every pixel the subtitles drew. */
function drawnMask(rgb, width, height, tolerance = 60) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const distance =
      Math.abs(r - PROBE_BACKGROUND.r) + Math.abs(g - PROBE_BACKGROUND.g) + Math.abs(b - PROBE_BACKGROUND.b);
    mask[i] = distance > tolerance ? 255 : 0;
  }
  return mask;
}

/**
 * One frame of the subtitles drawn over the flat colour, at the real size of a
 * clip. The instant is reached by generating from zero and keeping the first
 * frame at or after it — NOT by seeking: `-ss` on a lavfi source is accepted
 * and silently ignored, so every frame came back as frame 0.
 */
function drawnFrameAt(assPath, seconds) {
  const rgb = ffmpegFrames(
    [
      "-f",
      "lavfi",
      "-i",
      `color=c=0x00FF00:s=${CLIP_RULES.width}x${CLIP_RULES.height}:r=${MASK_FPS}:d=${(seconds + 0.4).toFixed(3)}`,
      "-vf",
      `format=rgb24,ass=${basename(assPath)}${fontsDirOption()},select='gte(t\\,${seconds.toFixed(3)})',format=rgb24`,
      "-frames:v",
      "1",
      "-fps_mode",
      "passthrough",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { cwd: workDir },
  );
  if (rgb.length < CLIP_RULES.width * CLIP_RULES.height * 3) return null;
  return drawnMask(rgb, CLIP_RULES.width, CLIP_RULES.height);
}

/**
 * Where the burned-in text really landed, in the clip's own pixels — one frame
 * per text event, which is the whole union and nothing more (buildAssScript
 * says why). Sampling a time grid instead would have to be dense enough never
 * to step over a short line, and a grid that is dense enough is a grid nobody
 * can hold in memory.
 */
function measureTextBox(assPath, sampleTimes) {
  let box = null;
  let measured = 0;
  for (const time of sampleTimes) {
    const mask = drawnFrameAt(assPath, time);
    if (mask === null) continue;
    measured += 1;
    box = unionBox(box, boundingBoxOfBright(mask, CLIP_RULES.width, CLIP_RULES.height, 128));
  }
  return { box, frames: measured };
}

let fontsDirName = null;
function fontsDirOption() {
  return fontsDirName ? `:fontsdir=${fontsDirName}` : "";
}

/**
 * The two-pass loudness normalisation the pipeline uses everywhere: measure
 * what the segment really is, then apply that measurement once. A filter that
 * was asked to normalise is not proof that it did, which is why the finished
 * file is measured again afterwards.
 */
function measureLoudness(masterPath, startSeconds, lengthSeconds) {
  const result = ffmpegRead([
    "-loglevel",
    "info",
    "-ss",
    startSeconds.toFixed(3),
    "-t",
    lengthSeconds.toFixed(3),
    "-i",
    masterPath,
    "-map",
    "0:a:0",
    "-af",
    `loudnorm=I=${CLIP_RULES.targetLufs}:TP=${CLIP_RULES.truePeakDbMax}:LRA=11:print_format=json`,
    "-f",
    "null",
    "-",
  ]);
  const measured = parseLoudnormJson(result.output);
  if (!measured) {
    die(
      `the loudness of ${basename(masterPath)} at ${startSeconds.toFixed(1)} s could not be measured: nothing would prove the clip is normalised`,
    );
  }
  return measured;
}

/** What the finished file really is: duration, picture, loudness, bytes. */
function measureRendered(path) {
  const probe = ffprobeJson([
    "-show_entries",
    "format=duration,size",
    "-show_entries",
    "stream=codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels",
    path,
  ]);
  const video = (probe.streams ?? []).find((stream) => stream.codec_type === "video");
  const audio = (probe.streams ?? []).find((stream) => stream.codec_type === "audio");
  const loudness = ffmpegRead(["-loglevel", "info", "-i", path, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const summary = parseEbur128Summary(loudness.output);
  return {
    // format.duration is a string out of ffprobe: numeric at the boundary, once.
    durationSeconds: Number(probe.format?.duration),
    bytes: Number(probe.format?.size),
    video: video
      ? { codec: video.codec_name, width: Number(video.width), height: Number(video.height), frameRate: video.r_frame_rate }
      : null,
    audio: audio
      ? { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: Number(audio.channels) }
      : null,
    loudness: summary
      ? { integratedLufs: summary.integratedLufs, truePeakDb: summary.truePeakDb, rangeLu: summary.loudnessRangeLu }
      : null,
  };
}

/**
 * The contrast the text really has over what is behind it, measured on the
 * finished frames. The probe says which pixels are drawn; inside that mask the
 * dark ones are the plate and the light ones the letters, so the ratio needs
 * no assumption about either colour.
 */
function measureContrast(clipPath, assPath, times) {
  const results = [];
  for (const raw of times) {
    // Mask and frame are pinned to the SAME instant on the same grid, so they
    // cannot drift apart; when they did, every clip measured 1.0:1 because the
    // mask sat over a flat colour bed with no letters under it.
    const time = Math.ceil(raw * MASK_FPS) / MASK_FPS;
    const mask = drawnFrameAt(assPath, time);
    if (mask === null) continue;
    const frame = ffmpegFrames([
      "-ss",
      time.toFixed(3),
      "-i",
      clipPath,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ]);
    if (frame.length < CLIP_RULES.width * CLIP_RULES.height * 3) continue;
    const luminances = [];
    for (let i = 0; i < CLIP_RULES.width * CLIP_RULES.height; i += 1) {
      if (mask[i] === 0) continue;
      luminances.push(
        relativeLuminance({ r: frame[i * 3], g: frame[i * 3 + 1], b: frame[i * 3 + 2] }),
      );
    }
    if (luminances.length < 200) continue;
    luminances.sort((a, b) => a - b);
    const at = (fraction) => luminances[Math.min(luminances.length - 1, Math.floor(luminances.length * fraction))];
    // The letters are antialiased into the plate, so the extremes are the
    // honest pair: the fifth percentile is plate, the ninety-fifth is letter.
    const plate = at(0.05);
    const letter = at(0.95);
    results.push({
      atSeconds: Number(time.toFixed(2)),
      drawnPixels: luminances.length,
      ratio: contrastRatio(plate, letter),
    });
  }
  return results;
}

/**
 * Cuts, scales, normalises, burns the text in and puts the card on the end —
 * in one encode. The text is drawn AFTER the two pieces are joined, so the
 * hook, the subtitles and the card share one clock that starts at the first
 * frame of the clip.
 */
function renderClip(plan) {
  const { masterPath, startSeconds, lengthSeconds, assName, outPath, fps, measured } = plan;
  const endCardSeconds = CLIP_RULES.endCardSeconds;
  const graph = [
    `[0:v]fps=${fps},scale=${CLIP_RULES.width}:${CLIP_RULES.height}:force_original_aspect_ratio=increase,` +
      `crop=${CLIP_RULES.width}:${CLIP_RULES.height},setsar=1,format=yuv420p[v0]`,
    `[1:v]format=yuv420p,setsar=1[v1]`,
    `[0:a:0]aresample=48000,` +
      `loudnorm=I=${CLIP_RULES.targetLufs}:TP=${CLIP_RULES.truePeakDbMax}:LRA=11:` +
      `measured_I=${measured.inputI}:measured_TP=${measured.inputTp}:measured_LRA=${measured.inputLra}:` +
      `measured_thresh=${measured.inputThresh}:offset=${measured.targetOffset}:linear=true,` +
      `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a0]`,
    `[2:a]aformat=sample_fmts=fltp:channel_layouts=stereo[a1]`,
    `[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][ac]`,
    `[vc]ass=${assName}${fontsDirOption()},format=yuv420p[v]`,
  ];
  ffmpeg(
    [
      "-loglevel",
      "error",
      "-ss",
      startSeconds.toFixed(3),
      "-t",
      lengthSeconds.toFixed(3),
      "-i",
      masterPath,
      "-f",
      "lavfi",
      "-t",
      endCardSeconds.toFixed(3),
      "-i",
      `color=c=${CLIP_THEME.endCardBackground.replace("#", "0x")}:s=${CLIP_RULES.width}x${CLIP_RULES.height}:r=${fps}`,
      "-f",
      "lavfi",
      "-t",
      endCardSeconds.toFixed(3),
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-filter_complex",
      graph.join(";"),
      "-map",
      "[v]",
      "-map",
      "[ac]",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-profile:v",
      "high",
      "-level",
      "4.1",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      "-g",
      String(fps * 2),
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      outPath,
    ],
    { cwd: workDir },
  );
}

/** Three frames of the finished clip, so a person can look at it without a player. */
function writeLookFrames(clipPath, code, total) {
  mkdirSync(framesDir, { recursive: true });
  const shots = [
    { name: "open", at: 0.4 },
    { name: "mid", at: Math.max(0.6, (total - CLIP_RULES.endCardSeconds) / 2) },
    { name: "endcard", at: Math.max(0.6, total - CLIP_RULES.endCardSeconds / 2) },
  ];
  const written = [];
  for (const shot of shots) {
    const path = join(framesDir, `${code}-${shot.name}.jpg`);
    ffmpeg(["-loglevel", "error", "-ss", shot.at.toFixed(3), "-i", clipPath, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "3", path]);
    written.push({ name: shot.name, atSeconds: Number(shot.at.toFixed(2)), file: relative(path) });
  }
  return written;
}

function relative(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length).replace(/\\/g, "/") : path;
}

/** At most `count` entries of a list, evenly spread, always including the last. */
function pickSpread(values, count) {
  if (values.length <= count) return [...values];
  const step = (values.length - 1) / (count - 1);
  const picked = [];
  for (let index = 0; index < count; index += 1) picked.push(values[Math.round(index * step)]);
  return [...new Set(picked)];
}

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

const manifest = readManifest(slug);
const delivery = readDelivery(slug);

const permissionIssues = checkClipPermission(manifest);
if (permissionIssues.length > 0) {
  console.error(`make-clips: REFUSED ${slug} — no clip may be made from this series`);
  for (const entry of permissionIssues) console.error(`  - [${entry.code}] ${entry.message}`);
  process.exit(2);
}

const standIn = standInLabel(manifest);
if (standIn) {
  console.error(`make-clips: ${slug} is ours, not a licensed title (${standIn.why})`);
  console.error(`make-clips: every clip and every description will carry "${standIn.label}"`);
}

mkdirSync(workDir, { recursive: true });
mkdirSync(videoDir, { recursive: true });

if (fontsDirFlag) {
  if (!existsSync(fontsDirFlag)) die(`--fonts-dir ${fontsDirFlag} does not exist`);
  // libass is given a folder name relative to the work directory, because a
  // Windows drive letter inside a filter argument is read as a filter option.
  const target = join(workDir, "fonts");
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(fontsDirFlag)) {
    if (!/\.(ttf|otf|ttc)$/i.test(entry)) continue;
    writeFileSync(join(target, entry), readFileSync(join(fontsDirFlag, entry)));
  }
  fontsDirName = "fonts";
}
const font = chooseFont(fontsDirName ? join(workDir, "fonts") : null);
console.error(`make-clips: drawing with ${font.family} (libass resolved it to ${font.resolvedAs})`);

/* --- what each episode can give ------------------------------------------- */

const deliveryEpisodes = new Map(
  (delivery.episodes ?? []).map((episode) => [episode.episodeNumber, episode]),
);
const episodeReports = [];
const allMoments = [];
const seriesHook = manifest.localizedMetadata?.[manifest.defaultLocale]?.hook ?? null;

for (const episode of [...manifest.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)) {
  const delivered = deliveryEpisodes.get(episode.episodeNumber);
  if (!delivered) {
    die(`episode ${episode.episodeNumber} is in the manifest but not in series.json: they are out of step, run ingest again`);
  }
  const masterPath = join(deliveryRoot, slug, delivered.master);
  if (!existsSync(masterPath)) {
    die(`${masterPath} does not exist: a clip is cut from the master, not from the published renditions`);
  }
  const captions = readCues(slug, delivered);
  if (captions.cues.length === 0) {
    episodeReports.push({
      episodeNumber: episode.episodeNumber,
      accepted: 0,
      refused: 0,
      skipped: "no_captions",
      why: captions.missing
        ? `${captions.file} is not on disk`
        : "the subtitle file has no cues",
    });
    continue;
  }
  const analysis = analyseEpisode(masterPath, episode.episodeNumber);
  const proposal = proposeMoments(
    { durationMs: episode.durationMs, episodeNumber: episode.episodeNumber },
    { cues: captions.cues, scenes: analysis.scenes, detections: analysis.detections, loudness: analysis.loudness },
  );
  const kept = dropOverlapping(proposal.accepted).filter(
    (moment) => onlyKind === null || moment.kind === onlyKind,
  );
  for (const moment of kept) {
    allMoments.push({
      ...moment,
      masterPath,
      episodeSlug: episode.episodeSlug,
      episodeTitle: episode.title,
      episodeHook: episode.hook,
      episodeDurationMs: episode.durationMs,
      cues: captions.cues,
      captionLanguage: captions.language,
      genres: episode.genres ?? [],
      tropes: episode.tropes ?? [],
    });
  }
  // Why an episode gave nothing is as useful as what it gave: a list that
  // shortens in silence makes the series look poorer than it is.
  const reasons = new Map();
  for (const entry of proposal.refused) {
    for (const problem of entry.issues) {
      reasons.set(problem.code, (reasons.get(problem.code) ?? 0) + 1);
    }
  }
  episodeReports.push({
    episodeNumber: episode.episodeNumber,
    proposed: proposal.accepted.length + proposal.refused.length,
    accepted: proposal.accepted.length,
    keptAfterOverlap: kept.length,
    refused: proposal.refused.length,
    refusedBy: Object.fromEntries([...reasons.entries()].sort((a, b) => b[1] - a[1])),
    endCard: proposal.endCard,
    pictureCuts: analysis.scenes.length,
    captionCues: captions.cues.length,
  });
}

if (allMoments.length === 0) {
  console.error(`make-clips: ${slug} — no moment in this series can be posted`);
  for (const report of episodeReports) {
    const why = report.skipped
      ? `${report.skipped}: ${report.why}`
      : `${report.refused} refused (${Object.keys(report.refusedBy ?? {}).join(", ")})`;
    console.error(`  episode ${report.episodeNumber}: ${why}`);
  }
  process.exit(3);
}

/* --- identity, order, memory ---------------------------------------------- */

for (const moment of allMoments) {
  moment.identity = clipIdentity({
    seriesSlug: slug,
    episodeNumber: moment.episodeNumber,
    startMs: moment.startMs,
    endMs: moment.endMs,
  });
  moment.code = clipCode(moment.identity);
}

const clipsJsonPath = join(outRoot, "clips.json");
let previous = { schemaVersion: 1, seriesSlug: slug, clips: [] };
if (existsSync(clipsJsonPath)) {
  try {
    previous = JSON.parse(readFileSync(clipsJsonPath, "utf8"));
  } catch (error) {
    die(`${clipsJsonPath} is not readable JSON: ${error.message} — move it aside to start again`);
  }
}
const alreadyMade = Array.isArray(previous.clips) ? previous.clips : [];
const fresh = withoutProduced(allMoments, alreadyMade);
const wanted = perDay * days;
const ordered = spreadByEpisode(fresh).slice(0, wanted);
// A second run continues the calendar instead of writing over yesterday: the
// day it starts from is the day after the last one already planned.
const firstDay =
  alreadyMade.length > 0
    ? Math.max(...alreadyMade.map((clip) => (Number.isInteger(clip.day) ? clip.day : 0))) + 1
    : 0;
const scheduled = scheduleClips(ordered, { perDay, startDate: addDays(startDate, firstDay) }).map(
  (clip) => ({ ...clip, day: clip.day + firstDay }),
);

console.error(
  `make-clips: ${slug} — ${allMoments.length} postable moments, ${alreadyMade.length} already made, ` +
    `${fresh.length} left, ${scheduled.length} being cut now (${perDay} a day for ${days} day(s))`,
);
if (scheduled.length < wanted) {
  console.error(
    `make-clips: ${scheduled.length} is what the series really has, not ${wanted}: the rest would be the same seconds posted twice`,
  );
}

if (planOnly) {
  for (const clip of scheduled) {
    console.error(
      `  day ${clip.day + 1}  ep ${clip.episodeNumber}  ${clip.kind}  ` +
        `${(clip.startMs / 1000).toFixed(2)}-${(clip.endMs / 1000).toFixed(2)} s  score ${clip.score}`,
    );
  }
  process.exit(0);
}

/* --- cutting -------------------------------------------------------------- */

const started = Date.now();
const produced = [];
const renderSeconds = [];

for (const [index, clip] of scheduled.entries()) {
  const clipStarted = Date.now();
  const lengthSeconds = (clip.endMs - clip.startMs) / 1000;
  const probe = ffprobeJson([
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=r_frame_rate",
    clip.masterPath,
  ]);
  const [num, den] = String(probe.streams?.[0]?.r_frame_rate ?? "25/1").split("/").map(Number);
  const sourceFps = den > 0 ? num / den : 25;
  const fps = Math.min(30, Math.max(24, Math.round(sourceFps)));

  const clipCues = cuesForClip(clip.cues, clip.startMs, clip.endMs);
  const hook = hookLineFor({
    cues: clip.cues.filter((cue) => cue.endMs > clip.startMs && cue.startMs < clip.endMs),
    startMs: clip.startMs,
    episodeHook: clip.episodeHook,
    seriesHook,
  });
  const endCard = {
    title: manifest.title,
    promise: "Free. No coins, no unlocks.",
    address: siteHost,
    note: standIn ? standIn.label : null,
  };

  /*
   * Fit the type to the frame by measuring it, not by trusting a number: the
   * same subtitles are drawn over a flat colour, every drawn pixel is found,
   * and the type shrinks until the box is inside the area the platforms leave
   * free. A long line in a language nobody tested still fits, or the run says
   * it could not make it fit.
   */
  const safe = safeArea(CLIP_RULES.width, CLIP_RULES.height);
  const assName = `clip-${clip.code}.ass`;
  const assPath = join(workDir, assName);
  let scale = 1;
  let measurement = null;
  let fitted = false;
  let subtitles = null;
  for (let attempt = 0; attempt < CLIP_RULES.fitAttempts; attempt += 1) {
    subtitles = buildAssScript({
      cues: clipCues,
      hookLine: hook ? hook.text : null,
      endCard,
      clipSeconds: lengthSeconds,
      fontName: font.family,
      scale,
    });
    writeFileSync(assPath, subtitles.script);
    measurement = measureTextBox(assPath, subtitles.sampleTimes);
    const verdict = insideSafeArea(measurement.box, safe);
    measurement.safeArea = verdict;
    measurement.attempts = attempt + 1;
    measurement.overflowing = subtitles.overflowing;
    measurement.charsPerLine = subtitles.charsPerLine;
    // Two conditions, one lever. The type shrinks until the drawn pixels are
    // inside the area the platforms leave free AND no caption needs a third
    // line — a third line is a wall of text over somebody's face, and the
    // alternative, dropping the words that do not fit, puts half a sentence on
    // screen under the half being spoken.
    if (verdict.inside && subtitles.overflowing === 0) {
      fitted = true;
      break;
    }
    scale *= CLIP_RULES.fitShrink;
  }
  if (!fitted) {
    die(
      `clip ${clip.code} (episode ${clip.episodeNumber}) could not be made to fit in ${CLIP_RULES.fitAttempts} tries: ` +
        (measurement.safeArea.inside
          ? `${measurement.overflowing} caption(s) still need a third line at ${measurement.charsPerLine} characters a line`
          : `the text still reaches ${JSON.stringify(measurement.safeArea.outsideBy)} px past the safe area`),
    );
  }

  const measured = measureLoudness(clip.masterPath, clip.startMs / 1000, lengthSeconds);
  const fileName = `${clip.code}-ep${clip.episodeNumber}-${clip.kind.toLowerCase()}.mp4`;
  const outPath = join(videoDir, fileName);
  renderClip({
    masterPath: clip.masterPath,
    startSeconds: clip.startMs / 1000,
    lengthSeconds,
    assName,
    outPath,
    fps,
    measured,
  });

  const rendered = measureRendered(outPath);
  // Contrast is measured on four of the text events, spread across the clip and
  // always including the last one (the end card). Every event would be exact
  // and would roughly double the time a clip costs; four is what a sample buys
  // when the plate is opaque and therefore the same over every frame.
  const contrastTimes = pickSpread(subtitles.sampleTimes, 4);
  const contrast = measureContrast(outPath, assPath, contrastTimes);
  const frames = writeLookFrames(outPath, clip.code, rendered.durationSeconds);
  const elapsed = (Date.now() - clipStarted) / 1000;
  renderSeconds.push(elapsed);

  /* --- what it is posted with ------------------------------------------- */
  const perPlatform = {};
  for (const platform of platforms) {
    const definition = PLATFORMS[platform];
    if (rendered.durationSeconds > definition.maxSeconds) {
      perPlatform[platform] = {
        posted: false,
        why: `${rendered.durationSeconds.toFixed(1)} s is over ${definition.label}'s ${definition.maxSeconds} s cap`,
      };
      continue;
    }
    const link = buildClipLink({
      siteUrl,
      seriesSlug: slug,
      episodeSlug: clip.episodeSlug,
      startMs: clip.startMs,
      episodeDurationMs: clip.episodeDurationMs,
      platform,
      code: clip.code,
    });
    const hashtags = hashtagsFor(platform, { genres: clip.genres, tropes: clip.tropes });
    const description = describeClip({
      platform,
      seriesTitle: manifest.title,
      episodeNumber: clip.episodeNumber,
      hook: clip.episodeHook,
      link: link.url,
      hashtags,
      standIn,
    });
    perPlatform[platform] = { posted: true, link, ...description };
  }

  produced.push({
    identity: clip.identity,
    code: clip.code,
    seriesSlug: slug,
    seriesTitle: manifest.title,
    episodeNumber: clip.episodeNumber,
    episodeSlug: clip.episodeSlug,
    episodeTitle: clip.episodeTitle,
    kind: clip.kind,
    day: clip.day,
    scheduledFor: clip.scheduledFor,
    positionInDay: clip.positionInDay,
    startMs: clip.startMs,
    endMs: clip.endMs,
    file: relative(outPath),
    frames,
    hook: hook ? { text: hook.text, from: hook.from } : null,
    captionLanguage: clip.captionLanguage,
    captionCues: clipCues.length,
    score: clip.score,
    evidence: clip.evidence,
    notes: clip.notes,
    measured: {
      ...rendered,
      textBox: measurement.box,
      safeArea: safe,
      safeAreaClear: measurement.safeArea.inside,
      probeFrames: measurement.frames,
      typeScale: Number(scale.toFixed(3)),
      contrast,
      minContrast: contrast.length > 0 ? Math.min(...contrast.map((entry) => entry.ratio)) : null,
      renderSeconds: Number(elapsed.toFixed(2)),
      font: { family: font.family, resolvedAs: font.resolvedAs },
    },
    platforms: perPlatform,
    clipRulesVersion: CLIP_RULES_VERSION,
  });

  console.error(
    `make-clips: ${index + 1}/${scheduled.length}  ${fileName}  ` +
      `${rendered.durationSeconds.toFixed(1)} s  ${(rendered.bytes / 1_000_000).toFixed(1)} MB  ` +
      `${rendered.loudness ? `${rendered.loudness.integratedLufs.toFixed(1)} LUFS` : "loudness unread"}  ` +
      `contrast ${contrast.length > 0 ? Math.min(...contrast.map((entry) => entry.ratio)).toFixed(1) : "?"}:1  ` +
      `${elapsed.toFixed(1)} s`,
  );
}

/* --- what a person reads --------------------------------------------------- */

const allClips = [...alreadyMade, ...produced];
writeFileSync(
  clipsJsonPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      seriesSlug: slug,
      seriesTitle: manifest.title,
      siteUrl,
      clipRulesVersion: CLIP_RULES_VERSION,
      weights: CLIP_WEIGHTS,
      rules: CLIP_RULES,
      standIn,
      episodes: episodeReports,
      clips: allClips,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(join(outRoot, "da-pubblicare.md"), publishingList(allClips));
if (!keepWork) rmSync(workDir, { recursive: true, force: true });

const totalSeconds = (Date.now() - started) / 1000;
const average = renderSeconds.length > 0 ? renderSeconds.reduce((sum, value) => sum + value, 0) / renderSeconds.length : 0;
const worstContrast = produced
  .map((clip) => clip.measured.minContrast)
  .filter((value) => value !== null);
console.error("");
console.error(`make-clips: ${produced.length} clip(s) in ${totalSeconds.toFixed(1)} s`);
console.error(`make-clips: ${average.toFixed(1)} s per clip on this machine, so ${perDay} a day costs about ${((average * perDay) / 60).toFixed(1)} minutes`);
if (worstContrast.length > 0) {
  console.error(`make-clips: worst measured text contrast ${Math.min(...worstContrast).toFixed(1)}:1 (AA needs ${CLIP_RULES.contrastMin}:1)`);
}
console.error(`make-clips: ${relative(join(outRoot, "da-pubblicare.md"))} is the list to post from`);

/**
 * The list a person posts from: one block per clip, with the file, what to
 * write, where the link goes, and the day it is for. Everything needed is on
 * the page, so posting is reading and pasting, not deciding.
 */
function publishingList(clips) {
  const byDay = new Map();
  for (const clip of clips) {
    const list = byDay.get(clip.day) ?? [];
    list.push(clip);
    byDay.set(clip.day, list);
  }
  const lines = [
    `# ${manifest.title} — clips to post`,
    "",
    `Generated by \`scripts/make-clips.mjs\`. ${clips.length} clip(s), ${byDay.size} day(s).`,
    `Site: ${siteUrl}. Rules version ${CLIP_RULES_VERSION}.`,
    "",
    "Every word below comes from the series' own metadata or a fixed fragment;",
    "nothing here was written by a model. Change the wording freely — but if you",
    "add a claim, it is yours, not the machine's.",
    "",
  ];
  if (standIn) {
    lines.push(
      `> **${standIn.label}.** This series is ours (${standIn.why}). The label is on every clip and in every description so nobody mistakes it for a licensed drama.`,
      "",
    );
  }
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const list = byDay.get(day);
    lines.push(`## Day ${day + 1} — ${list[0]?.scheduledFor ?? ""} (${list.length} clips)`, "");
    for (const clip of list) {
      lines.push(
        `### ${clip.code} · Episode ${clip.episodeNumber} · ${clip.kind}`,
        "",
        `- **File:** \`${clip.file}\``,
        `- **Moment:** ${(clip.startMs / 1000).toFixed(1)}–${(clip.endMs / 1000).toFixed(1)} s of episode ${clip.episodeNumber}, ` +
          `${clip.measured.durationSeconds.toFixed(1)} s with the end card`,
        `- **Why this moment:** score ${clip.score} — ${clip.evidence.parts.map((part) => `${part.name} ${part.value} (${part.points})`).join(", ")}`,
        `- **Measured:** ${clip.measured.video?.width}x${clip.measured.video?.height}, ` +
          `${clip.measured.loudness ? `${clip.measured.loudness.integratedLufs.toFixed(1)} LUFS` : "loudness unread"}, ` +
          `${(clip.measured.bytes / 1_000_000).toFixed(1)} MB, text contrast ${clip.measured.minContrast ?? "?"}:1`,
        `- **Look at it:** ${clip.frames.map((frame) => `\`${frame.file}\``).join(", ")}`,
        "",
      );
      for (const [platform, entry] of Object.entries(clip.platforms)) {
        const definition = PLATFORMS[platform];
        if (!entry.posted) {
          lines.push(`**${definition.label}** — not posted: ${entry.why}`, "");
          continue;
        }
        lines.push(`**${definition.label}**${entry.title ? ` — title: \`${entry.title}\`` : ""}`, "");
        lines.push("```", entry.text, "```", "");
        lines.push(
          `Link (${entry.linkPlacement === "bio" ? "put it in the bio, Instagram does not take one in a caption" : `in the ${entry.linkPlacement}`}): ${entry.link.url}`,
        );
        if (entry.link.whyNoStart) lines.push(`_${entry.link.whyNoStart}_`);
        lines.push("");
      }
    }
  }
  lines.push(
    "## What only you can do",
    "",
    "- The accounts: creating them, staying logged in, and pressing Post. Nothing here touches a platform.",
    "- Reading the numbers: `utm_source` says the platform, `utm_campaign` is `clip-<code>`, so a clip's views map to the code above.",
    "- Deciding what a bad clip means. See `docs/clips.md`.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
