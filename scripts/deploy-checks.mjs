/**
 * Refuses to publish a web export that would fail silently in production.
 *
 *   node scripts/deploy-checks.mjs env      before `next build`
 *   node scripts/deploy-checks.mjs export   after `next build`
 *
 * "env" checks the configuration the build is about to bake in. "export"
 * checks the files that were actually produced — a correct configuration is
 * not proof of a correct artifact.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const exportDir = resolve(repoRoot, "apps/web/out");
const mode = process.argv[2];
const failures = [];

function httpsOrigin(name) {
  const raw = process.env[name]?.trim() ?? "";
  if (!raw) {
    failures.push(`${name} is not set`);
    return null;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    failures.push(`${name} is not a URL: "${raw}"`);
    return null;
  }
  if (url.protocol !== "https:") failures.push(`${name} must use https: "${raw}"`);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    failures.push(`${name} points to this machine: "${raw}"`);
  }
  return url;
}

/** Same rule as apps/web/next.config.ts: explicit version, else the commit. */
function appVersion() {
  const explicit = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
  if (explicit) return explicit;
  const git = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return git.status === 0 ? git.stdout.trim() : "";
}

function checkEnv() {
  // Without a version, events cannot be tied to the code and catalog that
  // produced them (MP-7).
  const version = appVersion();
  if (!version || version === "0.0.0") {
    failures.push("no app version: set NEXT_PUBLIC_APP_VERSION or build from a git checkout");
  } else {
    console.error(`deploy-checks: app version ${version}`);
  }
  if (process.env.FLOW_STRESS_EPISODES?.trim()) {
    failures.push(
      "FLOW_STRESS_EPISODES is set: that is a scale-test catalog, never a publishable one",
    );
  }
  const site = httpsOrigin("NEXT_PUBLIC_SITE_URL");
  if (site && (site.pathname !== "/" || site.search || site.hash)) {
    failures.push(`NEXT_PUBLIC_SITE_URL must be an origin without path: "${site.href}"`);
  }

  if (process.env.FLOW_ALLOW_NO_ANALYTICS === "1") {
    console.error(
      "WARNING: FLOW_ALLOW_NO_ANALYTICS=1 — this export measures nothing. " +
        "Retention, completion and producer minutes will be unknown.",
    );
  } else {
    httpsOrigin("NEXT_PUBLIC_ANALYTICS_ENDPOINT");
  }
}

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith(".html") ? [path] : [];
  });
}

function metaContent(html, key) {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]*)"`,
    "g",
  );
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

/**
 * Every asset the catalog promises must be a file in the export (CP-1, CP-3).
 * A caption marked "ready" whose file was never copied shows no text, and the
 * catalog would still say it is there.
 */
function checkCatalogAssets(feedCatalog) {
  let checked = 0;
  const missing = [];
  const seen = new Set();
  const require = (item, kind, url) => {
    if (typeof url !== "string" || url.length === 0) {
      missing.push(`${item.id}: ${kind} has no URL`);
      return;
    }
    // The stress catalog distinguishes posters with a query string.
    const path = url.split("?")[0];
    if (!path.startsWith("/")) {
      missing.push(`${item.id}: ${kind} is not a site path: "${url}"`);
      return;
    }
    if (seen.has(path)) return;
    seen.add(path);
    checked += 1;
    try {
      statSync(join(exportDir, path.slice(1)));
    } catch {
      missing.push(`${item.id}: ${kind} ${path} is not in the export`);
    }
  };
  for (const item of feedCatalog.items) {
    const playback = item.playback ?? {};
    require(item, "video", playback.reference);
    require(item, "poster", playback.posterReference);
    require(item, "share card", playback.shareCardReference);
    for (const track of item.captions ?? []) {
      if (track.status === "ready") require(item, `captions [${track.language}]`, track.url);
    }
  }
  for (const failure of missing) failures.push(failure);
  console.error(`deploy-checks: ${checked} catalog assets resolved in the export`);
}

/**
 * Each packaged episode keeps a record next to its renditions (manifest.json:
 * the master's file name and hash, the ffmpeg build, the gate options). Ingest
 * needs it to resume; a viewer does not, so it never leaves in the export.
 */
function stripPackagingRecords() {
  const seriesRoot = join(exportDir, "content", "series");
  if (!existsSync(seriesRoot)) return;
  let removed = 0;
  for (const series of readdirSync(seriesRoot)) {
    const hls = join(seriesRoot, series, "hls");
    if (!existsSync(hls)) continue;
    for (const episode of readdirSync(hls)) {
      const record = join(hls, episode, "manifest.json");
      if (existsSync(record)) {
        rmSync(record);
        removed += 1;
      }
    }
  }
  console.error(`deploy-checks: ${removed} packaging records kept out of the export`);
}

function checkExport() {
  stripPackagingRecords();
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ?? "";
  if (!site) failures.push("NEXT_PUBLIC_SITE_URL is not set: cannot verify preview URLs");

  let files;
  try {
    files = htmlFiles(exportDir);
  } catch {
    failures.push(`no export found at ${relative(repoRoot, exportDir)}`);
    return;
  }

  for (const required of ["index.html", "404.html"]) {
    if (!files.some((file) => relative(exportDir, file) === required)) {
      failures.push(`export is missing ${required}`);
    }
  }

  const watchPages = files.filter((file) =>
    relative(exportDir, file).startsWith("watch"),
  );
  if (watchPages.length === 0) failures.push("export has no /watch episode pages");

  for (const file of files) {
    const html = readFileSync(file, "utf8");
    const name = relative(exportDir, file);
    if (/localhost|127\.0\.0\.1/.test(html)) {
      failures.push(`${name} mentions localhost`);
    }
    for (const key of ["og:image", "twitter:image", "og:url"]) {
      for (const value of metaContent(html, key)) {
        if (site && !value.startsWith(`${site}/`)) {
          failures.push(`${name} ${key} is not on ${site}: "${value}"`);
        }
      }
    }
    if (watchPages.includes(file)) {
      if (metaContent(html, "og:image").length === 0) {
        failures.push(`${name} has no og:image: shared links would show no picture`);
      }
      // VIR-4: a wide card is cropped to about 1.91:1 by the crawlers. A
      // preview that does not declare a landscape size is a portrait poster
      // about to be cut to a thin band.
      const width = Number(metaContent(html, "og:image:width")[0]);
      const height = Number(metaContent(html, "og:image:height")[0]);
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        failures.push(`${name} does not declare og:image:width/height`);
      } else if (width <= height) {
        failures.push(
          `${name} preview is ${width}x${height}: a portrait card is cropped to a band on X and Facebook`,
        );
      }
    }
  }

  // The feed fetches its catalog after first play: without it, nobody can
  // swipe past the second episode.
  let feedCatalog = null;
  try {
    const text = readFileSync(join(exportDir, "catalog/feed.json"), "utf8");
    feedCatalog = JSON.parse(text);
    // Licence terms and the producer of record stay on the build side.
    for (const field of ["producerId", "territories", "socialClipsAllowed"]) {
      if (text.includes(`"${field}"`)) failures.push(`catalog/feed.json carries "${field}"`);
    }
  } catch {
    failures.push("export has no readable catalog/feed.json");
  }
  if (feedCatalog) {
    if (!Array.isArray(feedCatalog.items) || feedCatalog.items.length === 0) {
      failures.push("catalog/feed.json lists no episodes");
    } else if (feedCatalog.items.some((item) => String(item.id).startsWith("item_stress_"))) {
      failures.push("catalog/feed.json contains the stress catalog");
    } else {
      checkCatalogAssets(feedCatalog);
    }
  }

  console.error(
    `deploy-checks: ${files.length} HTML files, ${watchPages.length} episode pages checked`,
  );
}

if (mode === "env") checkEnv();
else if (mode === "export") checkExport();
else failures.push(`unknown mode "${mode}" (use "env" or "export")`);

if (failures.length > 0) {
  console.error(`deploy-checks ${mode}: NOT publishable`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.error(`deploy-checks ${mode}: ok`);
