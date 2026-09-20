/**
 * Proves the compilation splitter on a real file whose true boundaries are
 * known to the frame.
 *
 *   node scripts/split-proof.mjs [--keep]
 *
 * Builds, from the stand-in episodes, one long vertical file the way studios
 * glue a mini-series together, with a different transition at every
 * boundary — a hard cut, a fade to black, a few frames of black, a pause in
 * the sound, a cross-dissolve, another hard cut — and a shot change inside
 * every episode, because real drama cuts between shots every few seconds and
 * a splitter that only looks for picture cuts would cut there. The GOP is
 * long, so boundaries fall between keyframes, as they do in a real export.
 *
 * Then, for real, through the commands the workflow runs:
 *
 *   1. `split-compilation propose` must place every boundary it can see
 *      within one frame of the truth, and mark LOW or NONE every boundary it
 *      cannot tell from a shot change (the hard cuts, the dissolve);
 *   2. a 16:9 file with the vertical picture in the middle must be reported
 *      as pillarboxed, and a crop offered, never applied by default;
 *   3. `split` must refuse without the studio's permission, without a
 *      person's confirmation, and on a cuts file made for another file;
 *   4. on the confirmed cuts (one corrected by hand, as a person would) it
 *      must write masters whose first frame IS the compilation frame at the
 *      cut, not the one before or after, with the exact frame count;
 *   5. `ingest-series` must accept those masters as a series;
 *   6. the crop, asked for explicitly, must give a vertical master, and say
 *      it is lower quality.
 *
 * Nothing touches the repository: everything goes to a temporary folder.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const standIn = join(repoRoot, "content", "series", "signal-night");
const keep = process.argv.includes("--keep");
const work = mkdtempSync(join(tmpdir(), "flow-split-proof-"));
const FPS = 25;
const SAMPLES_PER_FRAME = 48_000 / FPS;
/** Every episode cuts to a new shot this many frames in: a decoy for the splitter. */
const DECOY_FRAME = 100;

function ffmpeg(args, cwd = work) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(`split-proof: ffmpeg failed\n${(result.stderr ?? "").slice(-2000)}`);
    process.exit(1);
  }
  return result;
}

function node(script, args) {
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", script), ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

const LOSSLESS = ["-c:v", "libx264", "-qp", "0", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "pcm_s16le"];

/**
 * One episode as it sits in the compilation: `frames` long, a new shot at
 * DECOY_FRAME (mirrored and recoloured, the sound carrying on), and the
 * ending its transition needs.
 */
function episodePiece(name, { master, frames, hue = null, fadeOut = false, silentTail = 0 }) {
  const path = join(work, `${name}.mkv`);
  const seconds = frames / FPS;
  const picture = [
    `[0:v]fps=${FPS},trim=end_frame=${frames},setpts=PTS-STARTPTS,split[p][q]`,
    `[p]trim=end_frame=${DECOY_FRAME},setpts=PTS-STARTPTS[p1]`,
    // As strong a cut as any between two episodes: only the lengths tell them apart.
    `[q]trim=start_frame=${DECOY_FRAME},setpts=PTS-STARTPTS,hflip,negate,hue=h=70:s=1.4[q1]`,
    `[p1][q1]concat=n=2:v=1:a=0${hue === null ? "" : `,hue=h=${hue}`}` +
      // A fade to black that ends on three black frames, as an ending does.
      `${fadeOut ? `,fade=t=out:start_frame=${frames - 15}:nb_frames=12` : ""}[v]`,
  ];
  const sound =
    `[0:a]aresample=48000,atrim=end_sample=${frames * SAMPLES_PER_FRAME},asetpts=PTS-STARTPTS` +
    (silentTail > 0 ? `,volume=enable='gte(t,${(frames - silentTail) / FPS})':volume=0` : "") +
    (fadeOut ? `,afade=t=out:st=${seconds - 0.6}:d=0.6` : "") +
    "[a]";
  ffmpeg(["-i", master, "-filter_complex", [...picture, sound].join(";"), "-map", "[v]", "-map", "[a]", ...LOSSLESS, path]);
  return { path, frames };
}

function blackPiece(frames) {
  const path = join(work, "black.mkv");
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=720x1280:r=${FPS}:d=${frames / FPS}`,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-filter_complex",
    `[0:v]trim=end_frame=${frames}[v];[1:a]atrim=end_sample=${frames * SAMPLES_PER_FRAME}[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    ...LOSSLESS,
    path,
  ]);
  return { path, frames };
}

/** A one-second cross-dissolve from `a` into `b`: no frame belongs to only one of them. */
function dissolvePiece(a, b, overlap) {
  const path = join(work, "dissolve.mkv");
  ffmpeg([
    "-i",
    a.path,
    "-i",
    b.path,
    "-filter_complex",
    `[0:v][1:v]xfade=transition=fade:duration=${overlap / FPS}:offset=${(a.frames - overlap) / FPS}[v];` +
      `[0:a][1:a]acrossfade=d=${overlap / FPS}[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    ...LOSSLESS,
    path,
  ]);
  return { path, frames: a.frames + b.frames - overlap };
}

/** The compilation, encoded like a real delivery: one file, long GOP, AAC. */
function compile(pieces, target) {
  const inputs = pieces.flatMap((piece) => ["-i", piece.path]);
  const graph = `${pieces.map((_, i) => `[${i}:v][${i}:a]`).join("")}concat=n=${pieces.length}:v=1:a=1[v][a]`;
  ffmpeg([
    ...inputs,
    "-filter_complex",
    graph,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-g",
    "250",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    target,
  ]);
}

/** 32x32 grey thumbnail of one frame, picked by number (half a frame early lands on it). */
function frameThumb(file, frame) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(Math.max(0, (frame - 0.5) / FPS)),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      "scale=32:32,format=gray",
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0 || result.stdout.length !== 1024) {
    console.error(`split-proof: could not read frame ${frame} of ${file}`);
    process.exit(1);
  }
  return result.stdout;
}

function meanDifference(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function series(slug, count, extra = {}) {
  return {
    schemaVersion: 1,
    seriesId: `series_${slug.replace(/-/g, "_")}`,
    seriesSlug: slug,
    title: "Split Proof",
    status: "published",
    defaultLocale: "en",
    producerId: "prod_split_proof",
    producerOfRecord: "PROJECT FLOW — split proof",
    socialClipsAllowed: false,
    allowBelow1080p: true,
    episodeDurationMs: { min: 8000, max: 15000 },
    genres: ["thriller"],
    tropes: ["night"],
    rights: { territories: ["WORLD"], languages: ["en"], windowStart: null, windowEnd: null },
    localizedMetadata: { en: { title: "Split Proof", hook: "Split proof.", description: "Split proof." } },
    episodes: Array.from({ length: count }, (_, i) => ({
      episodeNumber: i + 1,
      master: `masters/episode-${i + 1}.mp4`,
      title: `Part ${i + 1}`,
      hook: "Split proof.",
      captions: [{ language: "en", file: `captions/episode-${i + 1}.en.vtt`, kind: "captions", default: true }],
    })),
    ...extra,
  };
}

function deliveryFor(slug, count, extra) {
  const root = join(work, "delivery");
  const dir = join(root, slug);
  mkdirSync(join(dir, "captions"), { recursive: true });
  for (let i = 1; i <= count; i += 1) {
    cpSync(join(standIn, "captions", "episode-1.en.vtt"), join(dir, "captions", `episode-${i}.en.vtt`));
  }
  writeFileSync(join(dir, "series.json"), `${JSON.stringify(series(slug, count, extra), null, 2)}\n`);
  return { root, dir };
}

const PERMISSION = {
  splitAllowed: true,
  splitPermission: { grantedOn: "2026-09-19", source: "split proof: a synthetic compilation made here" },
};

const results = [];
function record(name, ok, detail, output = "") {
  results.push({ name, ok, detail, output });
}

// --- the compilation ----------------------------------------------------------
const masters = [1, 2, 3, 4, 5].map((n) => join(standIn, "masters", `episode-${n}.mp4`));
console.error("split-proof: building a 7-episode compilation with known boundaries …");
const e1 = episodePiece("e1", { master: masters[0], frames: 250 });
const e2 = episodePiece("e2", { master: masters[1], frames: 230, fadeOut: true });
const e3 = episodePiece("e3", { master: masters[2], frames: 250 });
const gap = blackPiece(5);
const e4 = episodePiece("e4", { master: masters[3], frames: 220, silentTail: 20 });
const e5 = episodePiece("e5", { master: masters[4], frames: 240 });
const e6 = episodePiece("e6", { master: masters[0], frames: 250, hue: 140 });
const e7 = episodePiece("e7", { master: masters[1], frames: 235, hue: 220 });
const OVERLAP = 25;
const e5e6 = dissolvePiece(e5, e6, OVERLAP);
const compilation = join(work, "compilation.mp4");
compile([e1, e2, e3, gap, e4, e5e6, e7], compilation);

// Where each episode really starts, in frames of the compilation.
const b2 = e1.frames;
const b3 = b2 + e2.frames;
const b4 = b3 + e3.frames + gap.frames;
const b5 = b4 + e4.frames;
const dissolveStart = b5 + e5.frames - OVERLAP;
const b6 = dissolveStart + Math.round(OVERLAP / 2);
const b7 = b5 + e5e6.frames;
const TRUTH = [
  { kind: "hard cut", frame: b2, visible: false },
  { kind: "fade to black", frame: b3, visible: true },
  { kind: "short black (5 frames)", frame: b4, visible: true },
  { kind: "silence (0.8 s)", frame: b5, visible: true },
  { kind: "no gap: 1 s cross-dissolve", frame: b6, visible: false, dissolve: [dissolveStart, dissolveStart + OVERLAP] },
  { kind: "hard cut", frame: b7, visible: false },
];

// --- 1. the proposal ------------------------------------------------------------
const SLUG = "split-proof";
const delivery = deliveryFor(SLUG, 7, PERMISSION);
const proposalDir = join(work, "proposal");
const proposed = node("split-compilation.mjs", [
  "propose",
  SLUG,
  "--input",
  compilation,
  "--out",
  proposalDir,
  "--delivery-root",
  delivery.root,
]);
const cutsPath = join(proposalDir, `${SLUG}.cuts.json`);
let cuts = null;
if (!proposed.ok || !existsSync(cutsPath)) {
  record("the splitter proposes cuts", false, "propose failed", proposed.output);
} else {
  cuts = JSON.parse(readFileSync(cutsPath, "utf8"));
  const sheetsMissing = cuts.cuts.filter((cut) => !existsSync(join(proposalDir, cut.contactSheet ?? "none")));
  record(
    "a contact sheet for every cut",
    sheetsMissing.length === 0 && cuts.cuts.length === 6,
    `${cuts.cuts.length} cuts, ${cuts.cuts.length - sheetsMissing.length} sheets`,
    proposed.output,
  );
  TRUTH.forEach((truth, index) => {
    const cut = cuts.cuts[index];
    const error = cut ? cut.frame - truth.frame : null;
    const name = `boundary ${index + 1}, ${truth.kind}`;
    if (!cut) {
      record(name, false, "no cut proposed", proposed.output);
    } else if (truth.visible) {
      record(
        name,
        Math.abs(error) <= 1 && cut.confidence === "high",
        `frame ${cut.frame} vs ${truth.frame} (${error >= 0 ? "+" : ""}${error}), ${cut.confidence}: ${cut.why}`,
        proposed.output,
      );
    } else {
      // A shot change and a hard cut between episodes look the same; a
      // dissolve has no single frame. Either the frame is right and flagged,
      // or the splitter says it could not see it — never a confident miss.
      const flagged = cut.confidence === "low" || cut.confidence === "none";
      const exact = Math.abs(error) <= 1;
      record(
        name,
        flagged,
        `frame ${cut.frame} vs ${truth.frame} (${error >= 0 ? "+" : ""}${error}), ${cut.confidence}` +
          `${exact ? ", exact" : ""}: ${cut.why}`,
        proposed.output,
      );
    }
  });
  record(
    "a vertical compilation is not reported as pillarboxed",
    cuts.crop === null && !cuts.notes.some((note) => note.includes("PILLARBOX")),
    cuts.crop === null ? "no crop offered" : `crop offered: ${JSON.stringify(cuts.crop)}`,
    proposed.output,
  );
}

// --- 2. a pillarboxed delivery --------------------------------------------------
{
  const slug = "pillarbox-proof";
  const target = join(work, "pillarbox.mp4");
  ffmpeg([
    "-i",
    compilation,
    "-frames:v",
    String(b3),
    "-vf",
    "scale=608:1080,setsar=1,pad=1920:1080:656:0:black",
    "-t",
    String(b3 / FPS),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    target,
  ]);
  const box = deliveryFor(slug, 2, PERMISSION);
  const out = join(work, "pillarbox-proposal");
  const run = node("split-compilation.mjs", ["propose", slug, "--input", target, "--out", out, "--delivery-root", box.root]);
  const file = existsSync(join(out, `${slug}.cuts.json`)) ? JSON.parse(readFileSync(join(out, `${slug}.cuts.json`), "utf8")) : null;
  const crop = file?.crop;
  record(
    "a 16:9 file with a vertical picture inside is reported, crop not applied",
    Boolean(run.ok && crop && crop.apply === false && crop.lowerQuality === true && Math.abs(crop.w - 608) <= 8 && crop.h >= 1070 &&
      file.notes.some((note) => note.includes("PILLARBOX"))),
    crop ? `crop ${crop.w}x${crop.h} at ${crop.x},${crop.y}, apply ${crop.apply}` : "no crop reported",
    run.output,
  );

  // 6. The crop, asked for explicitly.
  if (file && crop) {
    const confirmed = { ...file, confirmed: true, crop: { ...crop, apply: true } };
    writeFileSync(join(box.dir, "cuts.json"), JSON.stringify(confirmed, null, 2));
    const split = node("split-compilation.mjs", ["split", slug, "--input", target, "--delivery-root", box.root]);
    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(box.dir, "masters", "episode-1.mp4")],
      { encoding: "utf8" },
    );
    const [width, height] = (probe.stdout ?? "").trim().split(",").map(Number);
    const provenance = existsSync(join(box.dir, "masters", "episode-1.mp4.source.json"))
      ? JSON.parse(readFileSync(join(box.dir, "masters", "episode-1.mp4.source.json"), "utf8"))
      : null;
    record(
      "an explicit crop gives a vertical master and says it is lower quality",
      split.ok && width / height > 0.45 && width / height < 0.65 && provenance?.cropped?.lowerQuality === true &&
        /LOWER QUALITY/.test(split.output),
      `${width}x${height}, provenance cropped: ${JSON.stringify(provenance?.cropped ?? null)}`,
      split.output,
    );
  }
}

// --- 3. refusals ------------------------------------------------------------------
if (cuts) {
  const confirmedCuts = JSON.parse(JSON.stringify(cuts));
  confirmedCuts.confirmed = true;
  // A person looked at the dissolve's sheet and moved the cut to its middle.
  const dissolveCut = confirmedCuts.cuts[4];
  dissolveCut.frame = b6;
  dissolveCut.at = new Date((b6 / FPS) * 1000).toISOString().slice(11, 23);
  // …and checked that every other cut is exact (the proof knows the truth).
  TRUTH.forEach((truth, index) => {
    confirmedCuts.cuts[index].frame = truth.frame;
    confirmedCuts.cuts[index].at = new Date((truth.frame / FPS) * 1000).toISOString().slice(11, 23);
  });

  const refusedFor = (name, prepare, code) => {
    const slug = `refuse-${name.replace(/[^a-z]+/g, "-")}`.slice(0, 40).replace(/-$/, "");
    const { root, dir } = deliveryFor(slug, 7, prepare.extra ?? PERMISSION);
    const file = prepare.cuts ? prepare.cuts(JSON.parse(JSON.stringify(confirmedCuts))) : confirmedCuts;
    writeFileSync(join(dir, "cuts.json"), JSON.stringify({ ...file, seriesSlug: slug }, null, 2));
    const run = node("split-compilation.mjs", ["split", slug, "--input", compilation, "--delivery-root", root, "--episodes", "1"]);
    record(
      `split refused: ${name}`,
      !run.ok && run.output.includes(`[${code}]`) && !existsSync(join(dir, "masters", "episode-1.mp4")),
      run.ok ? "SPLIT, should be refused" : `refused ${run.output.includes(`[${code}]`) ? `[${code}]` : "for another reason"}`,
      run.output,
    );
  };
  refusedFor("the studio did not allow splitting", { extra: {} }, "split_not_allowed");
  refusedFor("nobody confirmed the cuts", { cuts: (file) => ({ ...file, confirmed: false }) }, "cuts_not_confirmed");
  refusedFor(
    "the cuts were made for another file",
    { cuts: (file) => ({ ...file, source: { ...file.source, sha256: "0".repeat(64) } }) },
    "cuts_other_file",
  );
  refusedFor(
    "a label that disagrees with its frame (a half edit)",
    { cuts: (file) => ({ ...file, cuts: file.cuts.map((cut, i) => (i === 0 ? { ...cut, frame: cut.frame + 50 } : cut)) }) },
    "cuts_label",
  );

  // --- 4. the split, frame-accurate ---------------------------------------------
  writeFileSync(join(delivery.dir, "cuts.json"), JSON.stringify(confirmedCuts, null, 2));
  const started = Date.now();
  const split = node("split-compilation.mjs", ["split", SLUG, "--input", compilation, "--delivery-root", delivery.root]);
  const splitSeconds = (Date.now() - started) / 1000;
  if (!split.ok) {
    record("the confirmed cuts are split", false, "split failed", split.output);
  } else {
    const starts = [0, ...TRUTH.map((truth) => truth.frame)];
    const ends = [...TRUTH.map((truth) => truth.frame), e1.frames + e2.frames + e3.frames + gap.frames + e4.frames + e5e6.frames + e7.frames];
    const problems = [];
    const worst = { same: 0, neighbour: Infinity };
    for (let i = 0; i < 7; i += 1) {
      const master = join(delivery.dir, "masters", `episode-${i + 1}.mp4`);
      const count = spawnSync(
        "ffprobe",
        ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", master],
        { encoding: "utf8" },
      );
      const frames = Number((count.stdout ?? "").trim());
      if (frames !== ends[i] - starts[i]) problems.push(`episode ${i + 1}: ${frames} frames, expected ${ends[i] - starts[i]}`);
      if (i === 0) continue;
      // The master's first frame must be the compilation's frame at the cut —
      // and must NOT be the frame just before it (the previous episode).
      const first = frameThumb(master, 0);
      const same = meanDifference(first, frameThumb(compilation, starts[i]));
      const before = meanDifference(first, frameThumb(compilation, starts[i] - 1));
      worst.same = Math.max(worst.same, same);
      if (i !== 5) worst.neighbour = Math.min(worst.neighbour, before);
      if (!(same < 2) || (i !== 5 && !(before > same * 4))) {
        problems.push(`episode ${i + 1}: first frame differs by ${same.toFixed(2)} from the cut frame, ${before.toFixed(2)} from the one before`);
      }
      if (!existsSync(`${master}.source.json`)) problems.push(`episode ${i + 1}: no provenance file`);
    }
    record(
      "split masters start exactly on the cut frame, with the exact frame count",
      problems.length === 0,
      problems.join("; ") ||
        `7 masters; first frames within ${worst.same.toFixed(2)}/255 of the cut frame, the frame before differs by at least ${worst.neighbour.toFixed(1)}/255; split in ${splitSeconds.toFixed(1)} s`,
      split.output,
    );

    // --- 5. the masters are a publishable series ---------------------------------
    const published = join(work, "published");
    const ingest = spawnSync(
      process.execPath,
      [
        join(repoRoot, "scripts", "ingest-series.mjs"),
        SLUG,
        "--delivery-root",
        delivery.root,
        "--publish-root",
        published,
        "--generated-root",
        join(work, "generated"),
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const output = `${ingest.stdout ?? ""}${ingest.stderr ?? ""}`;
    const manifest = existsSync(join(work, "generated", `${SLUG}.ts`)) ? readFileSync(join(work, "generated", `${SLUG}.ts`), "utf8") : "";
    const identities = [...manifest.matchAll(/"sourceSha256": "([0-9a-f]{64})"/g)].map((match) => match[1]);
    const provenance = JSON.parse(readFileSync(join(delivery.dir, "masters", "episode-2.mp4.source.json"), "utf8"));
    record(
      "ingest accepts the split masters as a 7-episode series, identified by their frames",
      ingest.status === 0 && identities.length === 7 && identities[1] === provenance.identity,
      ingest.status === 0 ? `${identities.length} episodes published; episode 2 identity ${identities[1]?.slice(0, 12)}` : "REFUSED",
      output,
    );
  }
}

console.error("\nsplit-proof: a compilation with known boundaries\n");
for (const result of results) console.error(`  ${result.ok ? "ok  " : "FAIL"}  ${result.name} — ${result.detail}`);
const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  for (const result of failed) console.error(`\n--- ${result.name} ---\n${result.output.slice(-3000)}`);
  console.error(`\nsplit-proof: ${failed.length} case(s) did not behave as declared`);
  if (!keep) rmSync(work, { recursive: true, force: true });
  process.exit(1);
}
console.error(`\nsplit-proof: ${results.length} cases, all as declared`);
if (keep) console.error(`split-proof: files kept in ${work}`);
else rmSync(work, { recursive: true, force: true });
