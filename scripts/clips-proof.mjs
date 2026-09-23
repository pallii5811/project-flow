/**
 * Proves the clip machine on files whose truth is known to the frame.
 *
 *   node scripts/clips-proof.mjs [--keep]
 *
 * Two series go through it, for real, through the same command the owner runs:
 *
 *   1. a SYNTHETIC series built here, four 60-second episodes whose every
 *      feature is placed on purpose — a picture cut every four seconds, a
 *      line of dialogue every five, a still end card for the last three, and
 *      in three of the four episodes one defect each: black inside the
 *      cliffhanger, silence over most of it, and a line of dialogue running
 *      straight through the instant the clip would end. The rules say where
 *      the cliffhanger of the clean episode must start and stop; the proof
 *      knows the same answer from the way the file was built, and the two
 *      must agree to the frame — including in the rendered file, whose first
 *      frame must BE the master's frame at the cut;
 *
 *   2. the stand-in pack, ingested the ordinary way, which is the only path
 *      that goes through a real manifest.
 *
 * And the refusals, each proven to happen for its own reason: a series whose
 * licence does not allow clips, one that claims it does without recording
 * where the permission is, one with no subtitles at all, and the three
 * defects above.
 *
 * Everything asserted about a rendered clip is MEASURED on the rendered clip:
 * the text found by drawing the same subtitles over a flat colour so every
 * drawn pixel can be located, its contrast read off the finished frames, the
 * loudness read back with ebur128, the duration and the bytes from the file.
 *
 * Nothing touches the repository: everything goes to a temporary folder.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CLIP_RULES, safeArea } from "./lib/clip-rules.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const standIn = join(repoRoot, "content", "series", "signal-night");
const keep = process.argv.includes("--keep");
const work = mkdtempSync(join(tmpdir(), "flow-clips-proof-"));
const SITE = "https://cliffies.example";

/* ---- the shape of the synthetic episodes, decided here ------------------- */
const FPS = 25;
/** A picture cut every this many seconds, so a snap has somewhere to land. */
const SHOT_SECONDS = 4;
/** Motion for this long, then the end card. */
const STORY_SECONDS = 57;
const END_CARD_SECONDS = 3;
const EPISODE_SECONDS = STORY_SECONDS + END_CARD_SECONDS;
/** A line of dialogue from k*5+2 to k*5+4.5, which leaves 15, 16 and 55 in a gap. */
const CUE_EVERY = 5;
const CUE_FROM = 2;
const CUE_TO = 4.5;

function ffmpeg(args, cwd = work) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-loglevel", "error", "-y", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(`clips-proof: ffmpeg failed\n${(result.stderr ?? "").slice(-2500)}`);
    process.exit(1);
  }
  return result;
}

function node(script, args, env = {}) {
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", script), ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, NEXT_PUBLIC_SITE_URL: SITE, ...env },
  });
  return { ok: result.status === 0, code: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

const results = [];
function record(name, ok, detail, output = "") {
  results.push({ name, ok, detail, output });
}

/* -------------------------------------------------------------------------- */
/* The synthetic series                                                        */
/* -------------------------------------------------------------------------- */

/** Where a picture cut really is, in seconds. */
const SHOT_TIMES = [];
for (let t = SHOT_SECONDS; t < STORY_SECONDS; t += SHOT_SECONDS) SHOT_TIMES.push(t);

/** Where a line of dialogue really is. */
const CUES = [];
for (let k = 0; k * CUE_EVERY + CUE_TO < STORY_SECONDS - END_CARD_SECONDS; k += 1) {
  CUES.push({ start: k * CUE_EVERY + CUE_FROM, end: k * CUE_EVERY + CUE_TO });
}

function timestamp(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  const milli = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s}.${milli}`;
}

/**
 * The subtitle file, with the lines exactly where the picture puts them. A
 * `longCue` replaces the line nearest an instant with one that runs straight
 * through it, which is what a clip must never cut in the middle of.
 */
function captionsFor(longCue = null) {
  const cues = CUES.map((cue, index) => ({ ...cue, text: `Line ${index + 1} of the proof.` }));
  if (longCue) {
    cues.push({ start: longCue.start, end: longCue.end, text: "A line that runs straight through the cut." });
    cues.sort((a, b) => a.start - b.start);
  }
  const body = cues
    .map((cue) => `${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}`)
    .join("\n\n");
  return { text: `WEBVTT\n\n${body}\n`, cues };
}

const MASTERS = [1, 2, 3, 4, 5].map((n) => join(standIn, "masters", `episode-${n}.mp4`));

/**
 * One synthetic master: shots of `SHOT_SECONDS` cut from the stand-in beds,
 * every other one inverted so the cut between them is unmistakable, then a
 * still card for the last three seconds. The sound alternates loud and quiet
 * every four seconds, so a window has a loudness range to measure.
 */
function buildMaster(name, { blackAt = null, silentFrom = null, silentTo = null }) {
  const path = join(work, `${name}.mp4`);
  const shots = [];
  const pieces = [];
  let elapsed = 0;
  let index = 0;
  while (elapsed < STORY_SECONDS) {
    const length = Math.min(SHOT_SECONDS, STORY_SECONDS - elapsed);
    // The last shot swallows what is left, so no cut lands inside the end card.
    const isLast = elapsed + length + SHOT_SECONDS > STORY_SECONDS;
    const take = isLast ? STORY_SECONDS - elapsed : length;
    shots.push({ input: index % MASTERS.length, from: (index % 3) * 2, take, invert: index % 2 === 1 });
    elapsed += take;
    index += 1;
  }
  const inputs = MASTERS.flatMap((master) => ["-i", master]);
  shots.forEach((shot, i) => {
    pieces.push(
      `[${shot.input}:v]trim=${shot.from}:${shot.from + shot.take},setpts=PTS-STARTPTS,` +
        `scale=${CLIP_RULES.width}:${CLIP_RULES.height},setsar=1${shot.invert ? ",negate" : ""}[s${i}]`,
    );
  });
  const cardIndex = MASTERS.length;
  const silenceIndex = MASTERS.length + 1;
  pieces.push(
    `[${cardIndex}:v]scale=${CLIP_RULES.width}:${CLIP_RULES.height},setsar=1,trim=0:${END_CARD_SECONDS},setpts=PTS-STARTPTS[card]`,
  );
  const videoIn = `${shots.map((_, i) => `[s${i}]`).join("")}[card]`;
  pieces.push(`${videoIn}concat=n=${shots.length + 1}:v=1:a=0[vjoined]`);
  // Black where a clip must refuse to go.
  const blackFilter = blackAt
    ? `,drawbox=x=0:y=0:w=iw:h=ih:color=black@1:t=fill:enable='between(t,${blackAt.from},${blackAt.to})'`
    : "";
  pieces.push(`[vjoined]fps=${FPS}${blackFilter},format=yuv420p[v]`);

  const silence = silentFrom === null ? "" : `,volume=enable='between(t,${silentFrom},${silentTo})':volume=0`;
  pieces.push(
    `[${silenceIndex}:a]atrim=0:${STORY_SECONDS},asetpts=PTS-STARTPTS,` +
      // Loud for four seconds, quiet for four: a real loudness range to read.
      `volume=volume='if(lt(mod(t\\,8)\\,4)\\,0.85\\,0.16)':eval=frame${silence}[story]`,
    `[${silenceIndex}:a]atrim=0:${END_CARD_SECONDS},asetpts=PTS-STARTPTS,volume=0[quiet]`,
    `[story][quiet]concat=n=2:v=0:a=1[a]`,
  );

  ffmpeg([
    ...inputs,
    "-f",
    "lavfi",
    "-i",
    `color=c=0x101014:s=${CLIP_RULES.width}x${CLIP_RULES.height}:r=${FPS}:d=${END_CARD_SECONDS}`,
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=c=pink:r=48000:a=0.5:d=${EPISODE_SECONDS + 2}`,
    "-filter_complex",
    pieces.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-t",
    String(EPISODE_SECONDS),
    path,
  ]);
  return { path, shots };
}

/* ---- what the RULES say the cliffhanger of a clean episode must be -------- */
const endCardStart = STORY_SECONDS;
const expectedEndMs = Math.round((endCardStart - CLIP_RULES.holdBackSeconds) * 1000);
const wantedLength = Math.min(CLIP_RULES.cliffhangerMaxSeconds * 1000, expectedEndMs);
const unsnappedStartMs = expectedEndMs - wantedLength;
const nearestShot = SHOT_TIMES.reduce(
  (best, time) => (Math.abs(time - unsnappedStartMs / 1000) < Math.abs(best - unsnappedStartMs / 1000) ? time : best),
  SHOT_TIMES[0],
);
const expectedStartMs =
  Math.abs(nearestShot - unsnappedStartMs / 1000) <= CLIP_RULES.shotSnapSeconds
    ? Math.round(nearestShot * 1000)
    : unsnappedStartMs;

console.error(
  `clips-proof: building four ${EPISODE_SECONDS} s episodes — a cut every ${SHOT_SECONDS} s, a line every ${CUE_EVERY} s, ` +
    `a still card for the last ${END_CARD_SECONDS} s …`,
);
console.error(
  `clips-proof: the rules put the clean cliffhanger at ${(expectedStartMs / 1000).toFixed(3)}-${(expectedEndMs / 1000).toFixed(3)} s ` +
    `(held back ${CLIP_RULES.holdBackSeconds} s from the card, start snapped from ${(unsnappedStartMs / 1000).toFixed(1)} s onto the cut at ${nearestShot} s)`,
);

/* ---- the delivery ---------------------------------------------------------- */

const EPISODES = [
  { number: 1, name: "clean", options: {}, longCue: null },
  { number: 2, name: "black", options: { blackAt: { from: 30, to: 30.8 } }, longCue: null },
  { number: 3, name: "silent", options: { silentFrom: 25, silentTo: 45 }, longCue: null },
  {
    number: 4,
    name: "midword",
    options: {},
    // Runs through the instant the clip would end, with more than the snap's
    // reach on either side: it cannot be moved off the line, only refused.
    longCue: { start: 53.5, end: 56.9 },
  },
];

function deliveryFor(slug, { clips = true, permission = true, captions = true } = {}) {
  const root = join(work, `delivery-${slug}`);
  const dir = join(root, slug);
  mkdirSync(join(dir, "captions"), { recursive: true });
  mkdirSync(join(dir, "masters"), { recursive: true });
  const series = {
    schemaVersion: 1,
    seriesId: `series_${slug.replace(/-/g, "_")}`,
    seriesSlug: slug,
    title: "Clip Proof",
    status: "published",
    defaultLocale: "en",
    producerId: "prod_clip_proof",
    producerOfRecord: "PROJECT FLOW — clip proof, a synthetic series made here",
    socialClipsAllowed: clips,
    episodeDurationMs: { min: 8000, max: 120000 },
    genres: ["thriller", "drama"],
    tropes: ["mystery"],
    rights: { territories: ["WORLD"], languages: ["en"], windowStart: null, windowEnd: null },
    localizedMetadata: {
      en: { title: "Clip Proof", hook: "A synthetic series with known seconds.", description: "Clip proof." },
    },
    episodes: EPISODES.map((episode) => ({
      episodeNumber: episode.number,
      master: `masters/episode-${episode.number}.mp4`,
      title: `Part ${episode.number}`,
      hook: `The ${episode.name} episode of the proof.`,
      captions: [{ language: "en", file: `captions/episode-${episode.number}.en.vtt`, kind: "captions", default: true }],
    })),
  };
  if (clips && permission) {
    series.socialClipsPermission = {
      grantedOn: "2026-09-24",
      source: "clip proof: a synthetic series generated in this repository, ours to clip",
    };
  }
  writeFileSync(join(dir, "series.json"), `${JSON.stringify(series, null, 2)}\n`);
  for (const episode of EPISODES) {
    cpSync(masterFor(episode).path, join(dir, "masters", `episode-${episode.number}.mp4`));
    const file = captionsFor(episode.longCue);
    writeFileSync(join(dir, "captions", `episode-${episode.number}.en.vtt`), captions ? file.text : "WEBVTT\n\n");
  }
  return { root, dir, series };
}

const builtMasters = new Map();
function masterFor(episode) {
  if (!builtMasters.has(episode.number)) {
    builtMasters.set(episode.number, buildMaster(`episode-${episode.number}`, episode.options));
  }
  return builtMasters.get(episode.number);
}

/**
 * The manifest ingest would write, written here instead. The proof is about
 * which seconds become a clip, and putting four one-minute episodes through
 * the full HLS packaging would add ten minutes to it for nothing; the
 * stand-in pack below goes through the real ingest, so that path is proven
 * too. Durations are MEASURED on the files, never the numbers asked for.
 */
function manifestFor(slug, delivery, root, { clips = true, permission = true } = {}) {
  mkdirSync(root, { recursive: true });
  const episodes = EPISODES.map((episode) => {
    const path = join(delivery.dir, "masters", `episode-${episode.number}.mp4`);
    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-of", "json", "-show_entries", "format=duration", "-show_entries", "stream=width,height,r_frame_rate", "-select_streams", "v:0", path],
      { encoding: "utf8" },
    );
    const parsed = JSON.parse(probe.stdout);
    const stream = parsed.streams[0];
    const [num, den] = String(stream.r_frame_rate).split("/").map(Number);
    return {
      episodeNumber: episode.number,
      episodeSlug: `episode-${episode.number}`,
      title: `Part ${episode.number}`,
      hook: `The ${episode.name} episode of the proof.`,
      localizedMetadata: {},
      durationMs: Math.round(Number(parsed.format.duration) * 1000),
      width: Number(stream.width),
      height: Number(stream.height),
      fps: den > 0 ? num / den : FPS,
      playbackReference: `/content/series/${slug}/hls/episode-${episode.number}/000000000000/master.m3u8`,
      posterReference: `/content/series/${slug}/posters/episode-${episode.number}.webp`,
      shareCardReference: `/content/series/${slug}/share/episode-${episode.number}.jpg`,
      captions: [],
      sourceSha256: "0".repeat(64),
      publishedLufs: -16,
      genres: ["thriller", "drama"],
      tropes: ["mystery"],
    };
  });
  const manifest = {
    schemaVersion: 2,
    seriesId: delivery.series.seriesId,
    seriesSlug: slug,
    title: "Clip Proof",
    status: "published",
    defaultLocale: "en",
    localizedMetadata: delivery.series.localizedMetadata,
    producerId: "prod_clip_proof",
    producerOfRecord: "PROJECT FLOW — clip proof, a synthetic series made here",
    socialClipsAllowed: clips,
    socialClipsPermission: clips && permission ? delivery.series.socialClipsPermission : null,
    rights: delivery.series.rights,
    packagedAt: new Date().toISOString(),
    gateVersion: 1,
    episodes,
  };
  const name = slug.replace(/-/g, "_").toUpperCase();
  writeFileSync(
    join(root, `${slug}.ts`),
    `import type { SeriesManifest } from "../../content/seriesManifest";\n\n` +
      `export const ${name}_MANIFEST: SeriesManifest = ${JSON.stringify(manifest, null, 2)};\n`,
  );
  return manifest;
}

/* -------------------------------------------------------------------------- */
/* 1. Refusals                                                                 */
/* -------------------------------------------------------------------------- */

const SLUG = "clip-proof";
const delivery = deliveryFor(SLUG);
const manifestRoot = join(work, "generated");
manifestFor(SLUG, delivery, manifestRoot);

let runNumber = 0;
/** One run of the real command, into a folder of its own. Returns where it wrote. */
function runClips(slug, deliveryRoot, manifests, extra = []) {
  runNumber += 1;
  const out = join(work, `out-${runNumber}-${slug}`);
  return { ...node("make-clips.mjs", [slug, "--delivery-root", deliveryRoot, "--manifest-root", manifests, "--out", out, ...extra]), out };
}

{
  const slug = "clip-noperm";
  const noClips = deliveryFor(slug, { clips: false });
  const root = join(work, "generated-noperm");
  manifestFor(slug, noClips, root, { clips: false });
  const run = runClips(slug, noClips.root, root, ["--plan-only"]);
  record(
    "refused: the licence does not allow clips",
    !run.ok && run.code === 2 && run.output.includes("[clips_not_allowed]"),
    run.ok ? "PLANNED, should be refused" : `exit ${run.code}, ${run.output.includes("[clips_not_allowed]") ? "[clips_not_allowed]" : "another reason"}`,
    run.output,
  );
}

{
  const slug = "clip-nosource";
  const noSource = deliveryFor(slug, { permission: false });
  const root = join(work, "generated-nosource");
  manifestFor(slug, noSource, root, { permission: false });
  const run = runClips(slug, noSource.root, root, ["--plan-only"]);
  record(
    "refused: it claims clips are allowed but does not say where the permission is",
    !run.ok && run.code === 2 && run.output.includes("[clip_permission_missing]"),
    run.ok ? "PLANNED, should be refused" : `exit ${run.code}, ${run.output.includes("[clip_permission_missing]") ? "[clip_permission_missing]" : "another reason"}`,
    run.output,
  );
  // The same claim is refused earlier, by ingest, where it costs nothing.
  const ingest = node("ingest-series.mjs", [slug, "--delivery-root", noSource.root, "--publish-root", join(work, "pub"), "--generated-root", join(work, "gen")]);
  record(
    "ingest refuses the same claim before anything is encoded",
    !ingest.ok && /socialClipsPermission/.test(ingest.output),
    ingest.ok ? "INGESTED, should be refused" : "refused, naming socialClipsPermission",
    ingest.output,
  );
}

{
  const slug = "clip-nocaptions";
  const noCaptions = deliveryFor(slug, { captions: false });
  const root = join(work, "generated-nocaptions");
  manifestFor(slug, noCaptions, root);
  const run = runClips(slug, noCaptions.root, root, ["--plan-only"]);
  record(
    "refused: a series with no subtitles gives no clip",
    !run.ok && run.code === 3 && /no_captions/.test(run.output),
    run.ok ? "PLANNED, should be refused" : `exit ${run.code}, ${/no_captions/.test(run.output) ? "no_captions on every episode" : "another reason"}`,
    run.output,
  );
}

/* -------------------------------------------------------------------------- */
/* 2. The moments, against a truth known by construction                       */
/* -------------------------------------------------------------------------- */

const planRun = runClips(SLUG, delivery.root, manifestRoot, ["--per-day", "40", "--plan-only"]);
record(
  "the synthetic series is planned",
  planRun.ok,
  planRun.ok ? "planned" : `exit ${planRun.code}`,
  planRun.output,
);

const cliffRun = runClips(SLUG, delivery.root, manifestRoot, ["--kind", "cliffhanger", "--per-day", "4"]);
const cliffOut = cliffRun.out;
let cliffClips = null;
if (!cliffRun.ok || !existsSync(join(cliffOut, "clips.json"))) {
  record("the cliffhangers are cut", false, `exit ${cliffRun.code}`, cliffRun.output);
} else {
  cliffClips = JSON.parse(readFileSync(join(cliffOut, "clips.json"), "utf8"));

  /* --- only the clean episode gives a cliffhanger, and the other three say why --- */
  const byEpisode = new Map(cliffClips.episodes.map((entry) => [entry.episodeNumber, entry]));
  const refusalOf = (number) => Object.keys(byEpisode.get(number)?.refusedBy ?? {});
  record(
    "the episode with black inside the cliffhanger is refused for the black",
    refusalOf(2).includes("black_in_clip"),
    `episode 2 refused by: ${refusalOf(2).join(", ") || "nothing"}`,
    cliffRun.output,
  );
  record(
    "the episode that goes silent is refused for the silence",
    refusalOf(3).includes("silent_clip"),
    `episode 3 refused by: ${refusalOf(3).join(", ") || "nothing"}`,
    cliffRun.output,
  );
  record(
    "the episode whose line runs through the cut is refused for cutting mid-word",
    refusalOf(4).includes("cut_mid_line"),
    `episode 4 refused by: ${refusalOf(4).join(", ") || "nothing"}`,
    cliffRun.output,
  );

  const clip = cliffClips.clips.find((entry) => entry.episodeNumber === 1 && entry.kind === "cliffhanger");
  if (!clip) {
    record("the clean episode's cliffhanger is where the rules put it", false, "no cliffhanger produced for episode 1", cliffRun.output);
  } else {
    record(
      "the clean episode's cliffhanger is where the rules put it, to the millisecond",
      clip.startMs === expectedStartMs && clip.endMs === expectedEndMs,
      `${(clip.startMs / 1000).toFixed(3)}-${(clip.endMs / 1000).toFixed(3)} s, expected ${(expectedStartMs / 1000).toFixed(3)}-${(expectedEndMs / 1000).toFixed(3)} s`,
      cliffRun.output,
    );
    record(
      "only the clean episode gave a cliffhanger",
      cliffClips.clips.length === 1,
      `${cliffClips.clips.length} clip(s): ${cliffClips.clips.map((entry) => `ep${entry.episodeNumber}`).join(", ")}`,
      cliffRun.output,
    );

    /* --- frame accuracy: the first frame of the clip IS the master's frame --- */
    const master = join(delivery.dir, "masters", "episode-1.mp4");
    const clipPath = join(repoRoot, clip.file.replace(/^\//, ""));
    const path = existsSync(clipPath) ? clipPath : clip.file;
    const startSeconds = clip.startMs / 1000;
    const band = "crop=iw:ih*0.16:0:ih*0.44,scale=32:32,format=gray";
    const atCut = frameBand(master, startSeconds, band);
    const before = frameBand(master, startSeconds - 1 / FPS, band);
    const first = frameBand(path, 0, band);
    const sameness = meanDifference(first, atCut);
    const otherness = meanDifference(first, before);
    record(
      "the rendered clip's first frame is the master's frame at the cut, not the one before it",
      sameness < 6 && otherness > sameness * 2,
      `differs by ${sameness.toFixed(2)}/255 from the cut frame and ${otherness.toFixed(2)}/255 from the frame before it ` +
        `(band of the picture no text covers)`,
      "",
    );

    /* --- measured: safe area, contrast, loudness, duration, bytes --- */
    const safe = safeArea(CLIP_RULES.width, CLIP_RULES.height);
    const box = clip.measured.textBox;
    record(
      "every pixel of burned-in text is inside the area the platforms leave free",
      clip.measured.safeAreaClear === true &&
        box.left >= safe.left &&
        box.right <= safe.right &&
        box.top >= safe.top &&
        box.bottom <= safe.bottom,
      `text ${box.left}-${box.right} x ${box.top}-${box.bottom}; free area ${safe.left}-${safe.right} x ${safe.top}-${safe.bottom} ` +
        `(bottom ${(CLIP_RULES.uiBottomFraction * 100).toFixed(0)}% and right ${(CLIP_RULES.uiRightFraction * 100).toFixed(0)}% are the platform's own interface), ` +
        `measured on ${clip.measured.probeFrames} frames`,
    );
    record(
      "the burned-in text reaches WCAG AA over the frames it is really drawn on",
      clip.measured.minContrast !== null && clip.measured.minContrast >= CLIP_RULES.contrastMin,
      `${clip.measured.minContrast}:1 at worst over ${clip.measured.contrast.length} sampled moments (AA needs ${CLIP_RULES.contrastMin}:1)`,
    );
    record(
      "the clip is normalised to the loudness social platforms expect",
      clip.measured.loudness !== null &&
        Math.abs(clip.measured.loudness.integratedLufs - CLIP_RULES.targetLufs) <= CLIP_RULES.lufsToleranceLu &&
        clip.measured.loudness.truePeakDb <= CLIP_RULES.truePeakDbMax + 0.5,
      clip.measured.loudness
        ? `${clip.measured.loudness.integratedLufs} LUFS (target ${CLIP_RULES.targetLufs} +/- ${CLIP_RULES.lufsToleranceLu}), true peak ${clip.measured.loudness.truePeakDb} dBFS`
        : "loudness could not be read back",
    );
    const caps = Object.entries(clip.platforms).filter(([, entry]) => entry.posted);
    record(
      "the file is inside every platform's duration cap, end card included",
      caps.length === 4 && clip.measured.durationSeconds <= 60,
      `${clip.measured.durationSeconds.toFixed(2)} s (moment ${((clip.endMs - clip.startMs) / 1000).toFixed(2)} s + ${CLIP_RULES.endCardSeconds} s card), ` +
        `accepted by ${caps.length} platform(s), ${(clip.measured.bytes / 1_000_000).toFixed(1)} MB`,
    );
    record(
      "the picture is what every platform asks for",
      clip.measured.video?.width === 1080 && clip.measured.video?.height === 1920 && clip.measured.video?.codec === "h264" && clip.measured.audio?.codec === "aac",
      `${clip.measured.video?.width}x${clip.measured.video?.height} ${clip.measured.video?.codec} + ${clip.measured.audio?.codec} ${clip.measured.audio?.sampleRate} Hz`,
    );

    /* --- the words under it --- */
    const tiktok = clip.platforms.tiktok;
    const invented = /best|amazing|viral|millions|everyone|#1|top rated/i.test(tiktok.text);
    record(
      "nothing under the clip was invented",
      !invented &&
        tiktok.text.includes("Clip Proof") &&
        tiktok.text.includes(clip.hook ? "" : "") &&
        tiktok.link.url.startsWith(`${SITE}/watch/${SLUG}/episode-1?`),
      `"${tiktok.text.split("\n")[0]}" … link ${tiktok.link.url}`,
    );
    record(
      "the link opens the exact moment, the way the app really reads it",
      tiktok.link.openedAtSeconds === Math.floor(clip.startMs / 1000) &&
        new URL(tiktok.link.url).searchParams.get("t") === String(Math.floor(clip.startMs / 1000)) &&
        new URL(tiktok.link.url).searchParams.get("utm_source") === "tiktok" &&
        new URL(tiktok.link.url).searchParams.get("utm_campaign") === `clip-${clip.code}`,
      `t=${new URL(tiktok.link.url).searchParams.get("t")}, utm_source=tiktok, utm_campaign=clip-${clip.code}`,
    );
    record(
      "the hook line is something somebody really wrote",
      clip.hook !== null && typeof clip.hook.from === "string" && clip.hook.from.length > 0,
      clip.hook ? `"${clip.hook.text}" — ${clip.hook.from}` : "no hook line",
    );
  }
}

/** A 32x32 grey thumbnail of a band of one frame, chosen so no burned-in text covers it. */
function frameBand(file, seconds, band) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-ss", String(Math.max(0, seconds)), "-i", file, "-frames:v", "1", "-vf", band, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0 || result.stdout.length !== 1024) {
    console.error(`clips-proof: could not read the frame at ${seconds} s of ${file}`);
    process.exit(1);
  }
  return result.stdout;
}

function meanDifference(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/* -------------------------------------------------------------------------- */
/* 3. A second run continues instead of repeating                              */
/* -------------------------------------------------------------------------- */

{
  const out = join(work, "out-memory");
  const first = node("make-clips.mjs", [SLUG, "--delivery-root", delivery.root, "--manifest-root", manifestRoot, "--out", out, "--per-day", "2"]);
  const second = node("make-clips.mjs", [SLUG, "--delivery-root", delivery.root, "--manifest-root", manifestRoot, "--out", out, "--per-day", "2"]);
  const file = existsSync(join(out, "clips.json")) ? JSON.parse(readFileSync(join(out, "clips.json"), "utf8")) : null;
  const identities = new Set((file?.clips ?? []).map((clip) => clip.identity));
  const daysUsed = new Set((file?.clips ?? []).map((clip) => clip.day));
  record(
    "a second run continues the calendar instead of making the same clips again",
    Boolean(first.ok && second.ok && file && file.clips.length === 4 && identities.size === 4 && daysUsed.size === 2),
    file ? `${file.clips.length} clips, ${identities.size} different, over ${daysUsed.size} day(s)` : "no clips.json",
    `${first.output}\n---\n${second.output}`,
  );
}

/* -------------------------------------------------------------------------- */
/* 4. The stand-in pack, through the real manifest ingest wrote                */
/* -------------------------------------------------------------------------- */

{
  const out = join(work, "out-standin");
  const started = Date.now();
  const run = node("make-clips.mjs", ["signal-night", "--out", out, "--per-day", "5"]);
  const seconds = (Date.now() - started) / 1000;
  const file = existsSync(join(out, "clips.json")) ? JSON.parse(readFileSync(join(out, "clips.json"), "utf8")) : null;
  const clips = file?.clips ?? [];
  const labelled = clips.every((clip) =>
    Object.values(clip.platforms).every((entry) => !entry.posted || entry.text.includes("not a licensed drama")),
  );
  const measured = clips.map((clip) => clip.measured);
  record(
    "the stand-in pack goes through the real manifest and comes out as clips",
    Boolean(run.ok && clips.length === 5 && existsSync(join(out, "da-pubblicare.md"))),
    clips.length > 0
      ? `${clips.length} clips in ${seconds.toFixed(1)} s, ${(seconds / clips.length).toFixed(1)} s each`
      : `exit ${run.code}`,
    run.output,
  );
  record(
    "a pack of ours is labelled so nobody mistakes it for a licensed drama",
    clips.length > 0 && labelled && file.standIn !== null,
    clips.length > 0 ? `"${file.standIn?.label}" on every clip and in every description` : "no clips",
  );
  record(
    "every stand-in clip is measured, not assumed",
    measured.length > 0 &&
      measured.every(
        (entry) =>
          entry.safeAreaClear === true &&
          entry.minContrast >= CLIP_RULES.contrastMin &&
          entry.loudness !== null &&
          Math.abs(entry.loudness.integratedLufs - CLIP_RULES.targetLufs) <= CLIP_RULES.lufsToleranceLu &&
          entry.durationSeconds <= 60,
      ),
    measured.length > 0
      ? `contrast ${Math.min(...measured.map((entry) => entry.minContrast)).toFixed(1)}-${Math.max(...measured.map((entry) => entry.minContrast)).toFixed(1)}:1, ` +
        `loudness ${Math.min(...measured.map((entry) => entry.loudness.integratedLufs)).toFixed(1)}..${Math.max(...measured.map((entry) => entry.loudness.integratedLufs)).toFixed(1)} LUFS, ` +
        `${Math.min(...measured.map((entry) => entry.durationSeconds)).toFixed(1)}-${Math.max(...measured.map((entry) => entry.durationSeconds)).toFixed(1)} s, ` +
        `${(measured.reduce((sum, entry) => sum + entry.bytes, 0) / measured.length / 1_000_000).toFixed(1)} MB each`
      : "nothing measured",
  );
  if (measured.length > 0) {
    const perClip = measured.reduce((sum, entry) => sum + entry.renderSeconds, 0) / measured.length;
    console.error(
      `\nclips-proof: ${perClip.toFixed(1)} s of machine time per clip on the stand-in pack, ` +
        `so ten a day is about ${((perClip * 10) / 60).toFixed(1)} minutes`,
    );
  }
}

/* -------------------------------------------------------------------------- */

console.error("\nclips-proof: a synthetic series with known seconds, and the stand-in pack\n");
for (const result of results) console.error(`  ${result.ok ? "ok  " : "FAIL"}  ${result.name} — ${result.detail}`);
const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  for (const result of failed) console.error(`\n--- ${result.name} ---\n${String(result.output).slice(-3000)}`);
  console.error(`\nclips-proof: ${failed.length} case(s) did not behave as declared`);
  if (!keep) rmSync(work, { recursive: true, force: true });
  process.exit(1);
}
console.error(`\nclips-proof: ${results.length} cases, all as declared`);
if (keep) console.error(`clips-proof: files kept in ${work}`);
else rmSync(work, { recursive: true, force: true });
