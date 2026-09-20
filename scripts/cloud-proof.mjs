/**
 * Proves the cloud path end to end, with the commands the workflow runs and
 * nothing of the owner's involved: a link is downloaded, the file behind it
 * is cut into episodes, packaged, uploaded to a media store and published as
 * a manifest — then everything is run again to prove a second run costs
 * nothing.
 *
 *   node scripts/cloud-proof.mjs [--keep]
 *
 * The link is a local HTTP server, the media store is the local stand-in that
 * checks every signature (scripts/lib/fake-media-store.mjs). What is proven:
 *
 *   1. a link that answers a web page (a login) is refused, in one line,
 *      instead of saving the page as if it were a delivery;
 *   2. a plain link is downloaded under the name the server gives it;
 *   3. a link that gives ANOTHER file than the one the cuts were made for is
 *      refused before anything is encoded;
 *   4. the whole delivery is published: masters cut one at a time, uploaded,
 *      and deleted as soon as they are on the store (that is what keeps a
 *      90-minute delivery inside a runner's disk);
 *   5. a second run, with the masters gone, encodes nothing and uploads
 *      nothing — a workflow that is run twice does not pay twice;
 *   6. a run whose budget cannot fit a single episode says so and stops,
 *      instead of asking for another run that would do nothing either.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeMediaStore } from "./lib/fake-media-store.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const standIn = join(repoRoot, "content", "series", "signal-night");
const keep = process.argv.includes("--keep");
const work = mkdtempSync(join(tmpdir(), "flow-cloud-proof-"));
const SLUG = "cloud-proof";
const FPS = 25;
const LENGTHS = [250, 230, 240];

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(`cloud-proof: ffmpeg failed\n${(result.stderr ?? "").slice(-1500)}`);
    process.exit(1);
  }
}

/** Runs a script the way the workflow does, with the media store's variables. */
function run(script, args, env = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(repoRoot, "scripts", script), ...args], {
      env: { ...process.env, ...env },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => done({ code, ok: code === 0, output }));
  });
}

const results = [];
const record = (name, ok, detail, output = "") => results.push({ name, ok, detail, output });

// --- a delivery: three episodes glued together, with a black gap ------------
console.error("cloud-proof: building a three-episode delivery …");
const pieces = LENGTHS.map((frames, index) => {
  const path = join(work, `piece-${index + 1}.mkv`);
  ffmpeg([
    "-i",
    join(standIn, "masters", `episode-${index + 1}.mp4`),
    "-filter_complex",
    `[0:v]fps=${FPS},trim=end_frame=${frames},setpts=PTS-STARTPTS[v];` +
      `[0:a]aresample=48000,atrim=end_sample=${frames * 1920},asetpts=PTS-STARTPTS[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-qp",
    "0",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "pcm_s16le",
    path,
  ]);
  return { path, frames };
});
const compilation = join(work, "the-whole-series.mp4");
ffmpeg([
  ...pieces.flatMap((piece) => ["-i", piece.path]),
  "-filter_complex",
  `${pieces.map((_, i) => `[${i}:v][${i}:a]`).join("")}concat=n=${pieces.length}:v=1:a=1[v][a]`,
  "-map",
  "[v]",
  "-map",
  "[a]",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "20",
  "-g",
  "250",
  "-pix_fmt",
  "yuv420p",
  "-r",
  String(FPS),
  "-c:a",
  "aac",
  compilation,
]);
const other = join(work, "another-file.mp4");
ffmpeg(["-i", compilation, "-t", "20", "-c", "copy", other]);

// --- the "studio link": a local server --------------------------------------
const linkServer = createServer((request, response) => {
  if (request.url.startsWith("/needs-a-login")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return response.end("<html><body>Sign in to download</body></html>");
  }
  const file = request.url.startsWith("/another") ? other : compilation;
  const bytes = readFileSync(file);
  response.writeHead(200, {
    "content-type": "video/mp4",
    "content-length": bytes.length,
    "content-disposition": 'attachment; filename="THE WHOLE SERIES.mp4"',
  });
  response.end(request.method === "HEAD" ? undefined : bytes);
});
await new Promise((ready) => linkServer.listen(0, "127.0.0.1", ready));
const link = `http://127.0.0.1:${linkServer.address().port}`;

const store = await startFakeMediaStore({
  bucket: "cloud-proof-media",
  accessKeyId: "AKIDCLOUD",
  secretAccessKey: "cloud-proof-secret",
  allowedOrigins: ["*"],
});
const env = {
  MEDIA_BASE_URL: store.endpoint,
  R2_ENDPOINT: store.endpoint,
  R2_ACCESS_KEY_ID: "AKIDCLOUD",
  R2_SECRET_ACCESS_KEY: "cloud-proof-secret",
  R2_BUCKET: "cloud-proof-media",
};
/** Nothing of this proof reaches the repository: every root is in the temporary folder. */
const roots = [
  "--generated-root",
  join(work, "generated"),
  "--records-root",
  join(work, "records"),
  "--publish-root",
  join(work, "published"),
  "--stage-root",
  join(work, "stage"),
];
const manifestPath = join(work, "generated", `${SLUG}.ts`);

// --- 1 & 2: the download ------------------------------------------------------
const downloads = join(work, "delivery");
{
  const refused = await run("fetch-delivery.mjs", ["--out", downloads, `${link}/needs-a-login`]);
  record(
    "a link that answers a web page is refused",
    !refused.ok && /needs a login/.test(refused.output) && !existsSync(join(downloads, "needs-a-login")),
    refused.ok ? "DOWNLOADED, should be refused" : "refused, nothing saved",
    refused.output,
  );
  const fetched = await run("fetch-delivery.mjs", ["--out", downloads, `${link}/the-series.mp4`]);
  const saved = join(downloads, "THE WHOLE SERIES.mp4");
  record(
    "a plain link is downloaded, under the name the server gives",
    fetched.ok && existsSync(saved) && statSync(saved).size === statSync(compilation).size,
    fetched.ok ? `${(statSync(saved).size / 1e6).toFixed(1)} MB saved` : "the download failed",
    fetched.output,
  );
}

// --- the delivery folder in the repository's shape ---------------------------
const deliveryRoot = join(work, "content-series");
const deliveryDir = join(deliveryRoot, SLUG);
mkdirSync(join(deliveryDir, "captions"), { recursive: true });
for (let i = 1; i <= LENGTHS.length; i += 1) {
  cpSync(join(standIn, "captions", "episode-1.en.vtt"), join(deliveryDir, "captions", `episode-${i}.en.vtt`));
}
writeFileSync(
  join(deliveryDir, "series.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      seriesId: "series_cloud_proof",
      seriesSlug: SLUG,
      title: "Cloud Proof",
      status: "published",
      defaultLocale: "en",
      producerId: "prod_cloud_proof",
      producerOfRecord: "PROJECT FLOW — cloud proof",
      socialClipsAllowed: false,
      allowBelow1080p: true,
      splitAllowed: true,
      splitPermission: { grantedOn: "2026-09-19", source: "cloud proof: a delivery built here" },
      episodeDurationMs: { min: 8000, max: 15000 },
      genres: ["thriller"],
      tropes: ["night"],
      rights: { territories: ["WORLD"], languages: ["en"], windowStart: null, windowEnd: null },
      localizedMetadata: { en: { title: "Cloud Proof", hook: "Cloud proof.", description: "Cloud proof." } },
      episodes: LENGTHS.map((_, index) => ({
        episodeNumber: index + 1,
        master: `masters/episode-${index + 1}.mp4`,
        title: `Part ${index + 1}`,
        hook: "Cloud proof.",
        captions: [
          { language: "en", file: `captions/episode-${index + 1}.en.vtt`, kind: "captions", default: true },
        ],
      })),
    },
    null,
    2,
  )}\n`,
);

// The cuts a person confirmed, after looking at the contact sheets.
const proposalDir = join(work, "proposal");
const proposed = await run("split-compilation.mjs", [
  "propose",
  SLUG,
  "--input",
  downloads,
  "--out",
  proposalDir,
  "--delivery-root",
  deliveryRoot,
]);
const cutsFile = join(proposalDir, `${SLUG}.cuts.json`);
if (!proposed.ok || !existsSync(cutsFile)) {
  record("the proposal runs on the downloaded file", false, "propose failed", proposed.output);
} else {
  const cuts = JSON.parse(readFileSync(cutsFile, "utf8"));
  const truth = [LENGTHS[0], LENGTHS[0] + LENGTHS[1]];
  record(
    "the proposal runs on the downloaded file and finds both boundaries",
    cuts.cuts.length === 2 && cuts.cuts.every((cut, index) => Math.abs(cut.frame - truth[index]) <= 1),
    cuts.cuts.map((cut, index) => `${cut.frame} vs ${truth[index]} (${cut.confidence})`).join(", "),
    proposed.output,
  );
  writeFileSync(join(deliveryDir, "cuts.json"), JSON.stringify({ ...cuts, confirmed: true }, null, 2));
}

// --- 3: another file behind the same link ------------------------------------
{
  const elsewhere = join(work, "delivery-other");
  await run("fetch-delivery.mjs", ["--out", elsewhere, `${link}/another`]);
  const run3 = await run(
    "cloud-ingest.mjs",
    [SLUG, "--source", elsewhere, "--delivery-root", deliveryRoot, ...roots],
    env,
  );
  record(
    "a link that gives another file is refused before anything is encoded",
    !run3.ok && /another file than the one the cuts were made for/.test(run3.output) &&
      store.log.filter((entry) => entry.method === "PUT").length === 0,
    run3.ok ? "PUBLISHED, should be refused" : "refused, nothing encoded or uploaded",
    run3.output,
  );
}

// --- 4: the publish ----------------------------------------------------------
const publishRun = await run(
  "cloud-ingest.mjs",
  [SLUG, "--source", downloads, "--delivery-root", deliveryRoot, "--budget-minutes", "20", ...roots],
  env,
);
{
  const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : null;
  const urls = [...(manifest ?? "").matchAll(/"(https?:\/\/[^"]+)"/g)].map((match) => match[1]);
  const problems = [];
  if (!publishRun.ok) problems.push("the run did not finish");
  if (urls.length === 0 || urls.some((url) => !url.startsWith(`${store.endpoint}/content/series/${SLUG}/`))) {
    problems.push("the manifest does not point at the media store");
  }
  for (const url of urls.slice(0, 12)) {
    const response = await fetch(url);
    if (response.status !== 200) problems.push(`${url} answered ${response.status}`);
  }
  const masters = LENGTHS.map((_, index) => join(deliveryDir, "masters", `episode-${index + 1}.mp4`));
  if (masters.some((path) => existsSync(path))) problems.push("a master was left on disk after it was uploaded");
  if (!masters.every((path) => existsSync(`${path}.source.json`))) problems.push("a provenance file is missing");
  record(
    "the delivery is published: cut, packaged, uploaded, and the disk left clean",
    problems.length === 0,
    problems.join("; ") ||
      `${urls.length} media URLs on the store, ${store.log.filter((entry) => entry.method === "PUT").length} objects uploaded, no master left on disk`,
    publishRun.output,
  );
}

// --- 5: a second run costs nothing -------------------------------------------
{
  store.log.length = 0;
  const before = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : null;
  const again = await run(
    "cloud-ingest.mjs",
    [SLUG, "--source", downloads, "--delivery-root", deliveryRoot, "--budget-minutes", "20", ...roots],
    env,
  );
  const puts = store.log.filter((entry) => entry.method === "PUT").length;
  const after = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : null;
  record(
    "a second run, with the masters gone, encodes and uploads nothing",
    again.ok && puts === 0 && after === before && /episodes published in this run: 0/.test(again.output),
    again.ok ? `${puts} uploads, manifest ${after === before ? "unchanged" : "CHANGED"}` : "the second run failed",
    again.output,
  );
}

// --- 6: a budget that fits nothing -------------------------------------------
{
  const tight = caseDelivery();
  const run6 = await run(
    "cloud-ingest.mjs",
    [
      SLUG,
      "--source",
      downloads,
      "--delivery-root",
      tight,
      "--budget-minutes",
      "1",
      "--generated-root",
      join(work, "generated-tight"),
      "--records-root",
      join(work, "records-tight"),
      "--publish-root",
      join(work, "published-tight"),
      "--stage-root",
      join(work, "stage-tight"),
    ],
    env,
  );
  record(
    "a budget too small for one episode says so and stops",
    !run6.ok && /not one episode fits a budget/.test(run6.output),
    run6.ok ? "ran anyway" : "stopped, and said what to change",
    run6.output,
  );
}

/** A copy of the delivery with nothing published yet (its own records folder). */
function caseDelivery() {
  const copy = join(work, "content-series-tight");
  rmSync(copy, { recursive: true, force: true });
  cpSync(deliveryRoot, copy, { recursive: true });
  return copy;
}

await store.close();
linkServer.close();

console.error("\ncloud-proof: the workflow's own steps, end to end\n");
for (const result of results) console.error(`  ${result.ok ? "ok  " : "FAIL"}  ${result.name} — ${result.detail}`);
const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  for (const result of failed) console.error(`\n--- ${result.name} ---\n${result.output.slice(-3000)}`);
  console.error(`\ncloud-proof: ${failed.length} case(s) did not behave as declared`);
  if (!keep) rmSync(work, { recursive: true, force: true });
  process.exit(1);
}
console.error(`\ncloud-proof: ${results.length} cases, all as declared`);
if (keep) console.error(`cloud-proof: files kept in ${work}`);
else rmSync(work, { recursive: true, force: true });
