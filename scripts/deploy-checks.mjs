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

import { pagesLimitProblems, platformProblems } from "./lib/platform-checks.mjs";
import { isPublicLaunch, originOf } from "./lib/platform.mjs";
import { mediaBaseProblems } from "./lib/media-publish.mjs";

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

  // Media may live on another host (docs/cloud-ingest.md). If it does, this
  // build's security policy must allow exactly that host, so the address has
  // to be right here, at build time, not when a viewer presses play.
  const mediaBaseUrl = process.env.MEDIA_BASE_URL?.trim();
  if (mediaBaseUrl) {
    for (const problem of mediaBaseProblems(mediaBaseUrl)) failures.push(problem);
    const url = originOf(mediaBaseUrl);
    if (url && new URL(mediaBaseUrl).hostname.endsWith(".r2.dev")) {
      console.error(
        "WARNING: MEDIA_BASE_URL is an r2.dev address. Cloudflare rate-limits it and does not cache it; " +
          "connect a custom domain to the bucket before the beta grows (docs/cloud-ingest.md).",
      );
    } else if (url) {
      console.error(`deploy-checks: media from ${url}`);
    }
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
 * Every asset the catalog promises must be reachable: a file in the export
 * (CP-1, CP-3), or an object on MEDIA_BASE_URL — the one other origin this
 * build's security policy allows. A caption marked "ready" whose file was
 * never copied shows no text, and the catalog would still say it is there;
 * a video on a host the policy does not allow is blocked in every browser.
 */
function checkCatalogAssets(feedCatalog) {
  let checked = 0;
  let remote = 0;
  const missing = [];
  const seen = new Set();
  const mediaOrigin = originOf(process.env.MEDIA_BASE_URL);
  const require = (item, kind, url) => {
    if (typeof url !== "string" || url.length === 0) {
      missing.push(`${item.id}: ${kind} has no URL`);
      return;
    }
    // The stress catalog distinguishes posters with a query string.
    const path = url.split("?")[0];
    if (/^https?:\/\//i.test(path)) {
      // Media that left the export: ingest wrote these URLs (docs/cloud-ingest.md).
      const origin = originOf(path);
      if (!mediaOrigin) {
        missing.push(
          `${item.id}: ${kind} is on ${origin ?? path}, but MEDIA_BASE_URL is not set for this build: ` +
            "the security policy would block it, and nothing would play",
        );
      } else if (origin !== mediaOrigin) {
        missing.push(`${item.id}: ${kind} is on ${origin}, not on MEDIA_BASE_URL (${mediaOrigin})`);
      } else if (!seen.has(path)) {
        seen.add(path);
        remote += 1;
      }
      return;
    }
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
  console.error(
    `deploy-checks: ${checked} catalog assets resolved in the export` +
      (remote > 0 ? `, ${remote} on ${originOf(process.env.MEDIA_BASE_URL)} (checked there by ingest, before it wrote the manifest)` : ""),
  );
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
  const mediaBase = originOf(process.env.MEDIA_BASE_URL);
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
        // The link-preview picture may sit on the media host; the page address
        // never may (a share must point at the site the viewer opens).
        const allowed = [site, ...(key === "og:url" ? [] : [mediaBase])].filter(Boolean);
        if (site && !allowed.some((base) => value.startsWith(`${base}/`))) {
          failures.push(`${name} ${key} is not on ${allowed.join(" or ")}: "${value}"`);
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

  checkPlatform(files, site);

  console.error(
    `deploy-checks: ${files.length} HTML files, ${watchPages.length} episode pages checked`,
  );
}

/** The product's public name, read from its one constant (apps/web/src/lib/brand.ts). */
function brandName() {
  const source = readFileSync(resolve(repoRoot, "apps/web/src/lib/brand.ts"), "utf8");
  return /export const BRAND_NAME = "([^"]+)";/.exec(source)?.[1] ?? null;
}

function allFiles(dir, prefix = "", out = new Map()) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const stats = statSync(path);
    if (stats.isDirectory()) allFiles(path, rel, out);
    else out.set(rel, stats.size);
  }
  return out;
}

/**
 * Headers, the launch switch, the service worker, the manifest and the brand
 * (scripts/lib/platform-checks.mjs), and Cloudflare Pages' own limits.
 */
function checkPlatform(files, site) {
  const brand = brandName();
  if (!brand) {
    failures.push("apps/web/src/lib/brand.ts declares no BRAND_NAME");
    return;
  }
  const indexable = isPublicLaunch(process.env.FLOW_PUBLIC);
  const sizes = allFiles(exportDir);
  const read = (rel) => {
    const path = join(exportDir, rel);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };
  const pngSize = (rel) => {
    const path = join(exportDir, rel);
    if (!existsSync(path)) return null;
    const bytes = readFileSync(path);
    if (bytes.length < 24 || bytes.toString("latin1", 1, 4) !== "PNG") return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  };
  const problems = [
    ...platformProblems({
      pages: new Map(files.map((file) => [relative(exportDir, file), readFileSync(file, "utf8")])),
      files: [...sizes.keys()],
      text: read,
      size: (rel) => sizes.get(rel.split("\\").join("/")) ?? null,
      pngSize,
      indexable,
      site,
      brand,
      serviceWorkerOn: process.env.FLOW_SERVICE_WORKER !== "off",
    }),
    ...pagesLimitProblems(sizes),
  ];
  for (const problem of problems) failures.push(problem);
  console.error(
    `deploy-checks: ${brand}, ${indexable ? "PUBLIC (indexable)" : "closed beta (noindex)"}, ` +
      `${sizes.size} files for Pages`,
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
