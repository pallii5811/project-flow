/**
 * What the static export needs around its pages to be served well: caching,
 * security headers, the closed-beta switch, the service worker. Pure: the
 * writer (scripts/finish-export.mjs), the export check
 * (scripts/deploy-checks.mjs) and the tests (test/platform.test.ts) share it.
 */
import { createHash } from "node:crypto";

/**
 * The closed-beta switch. Only the exact value "1" opens the site to search
 * engines; apps/web/src/lib/siteMetadata.ts applies the same rule to the
 * pages' meta robots.
 */
export function isPublicLaunch(raw) {
  return typeof raw === "string" && raw.trim() === "1";
}

/** The origin of an http(s) URL, or null. */
export function originOf(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The policy every response carries. Scripts: 'self', plus inline scripts —
 * but each page also carries a meta policy listing the hash of every inline
 * script it has (withScriptPolicy), and a browser enforces both, so an inline
 * script that is not in the page as built does not run.
 *
 * hls.js needs blob: twice: its transmuxer runs in a worker made from a blob,
 * and Media Source playback gives the video a blob: URL. Media, posters and
 * playlists may come from MEDIA_BASE_URL once video leaves the export
 * (docs/content-operations.md §6); events go to the analytics collector.
 */
export function contentSecurityPolicy({ analyticsEndpoint, mediaBaseUrl } = {}) {
  const media = originOf(mediaBaseUrl);
  const analytics = originOf(analyticsEndpoint);
  const list = (...sources) => sources.filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${list("'self'", "data:", "blob:", media)}`,
    "font-src 'self'",
    `media-src ${list("'self'", "blob:", media)}`,
    `connect-src ${list("'self'", analytics, media)}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const REVALIDATE = "public, max-age=0, must-revalidate";

/**
 * The _headers file (Cloudflare Pages format, see pages-headers.mjs).
 * Cache-Control is never set by "/*": two matching rules would join their
 * values into one broken header. Each pattern is written once: Pages keeps
 * only the last rule of a pattern, so the removals of DOCUMENT_ONLY_HEADERS
 * go inside the rule that already exists for that pattern, never in a second
 * one (a second `/_next/static/*` cost every chunk and font its year of cache).
 */
export function headersFile({ indexable, analyticsEndpoint, mediaBaseUrl } = {}) {
  const seen = new Set();
  const rule = (pattern, ...headers) => {
    if (seen.has(pattern)) throw new Error(`_headers: "${pattern}" written twice, Pages would keep only the last`);
    seen.add(pattern);
    const notADocument = DOCUMENT_ONLY_PATHS.includes(pattern)
      ? DOCUMENT_ONLY_HEADERS.map((name) => `! ${name}`)
      : [];
    return [pattern, ...[...headers, ...notADocument].map((header) => `  ${header}`), ""];
  };
  const lines = [
    "# Written by scripts/finish-export.mjs at every build. Edit scripts/lib/platform.mjs, not this file.",
    "#",
    "# One rule per pattern: Pages keeps only the last rule written for a pattern.",
    "# The ! lines take the page-only headers (CSP, X-Frame-Options, Permissions-Policy)",
    "# off what is never a document: a script, a stylesheet, a font, a segment, the",
    "# catalog. There they would be about 450 bytes on each of some thirty responses",
    "# before the first frame and nothing else (measured, docs/decisions.md).",
    "# nosniff, HSTS, Referrer-Policy and X-Robots-Tag stay on everything.",
    "",
    ...rule(
      "/*",
      `Content-Security-Policy: ${contentSecurityPolicy({ analyticsEndpoint, mediaBaseUrl })}`,
      "X-Content-Type-Options: nosniff",
      "X-Frame-Options: DENY",
      "Referrer-Policy: strict-origin-when-cross-origin",
      "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Strict-Transport-Security: max-age=31536000",
      ...(indexable ? [] : ["X-Robots-Tag: noindex, nofollow"]),
    ),
    "# Pages: always asked again, so a deploy is seen on the next open.",
    ...rule("/", `Cache-Control: ${REVALIDATE}`),
    ...rule("/watch/*", `Cache-Control: ${REVALIDATE}`),
    "# Named by their content by next build: they never change.",
    ...rule("/_next/static/*", `Cache-Control: ${IMMUTABLE}`),
    "# Each encode lives in its own folder, named by the hash of its files",
    "# (scripts/ingest-series.mjs): a new cut is a new URL, so nothing here changes.",
    "# Only files inside such a folder; the export check refuses HLS outside one.",
    ...rule("/content/series/:series/hls/:episode/:revision/*", `Cache-Control: ${IMMUTABLE}`),
    "# Rebuilt at every ingest under the same name: short, a stale poster is only cosmetic.",
    ...rule(
      "/content/series/:series/posters/*",
      "Cache-Control: public, max-age=300, stale-while-revalidate=86400",
    ),
    ...rule(
      "/content/series/:series/share/*",
      "Cache-Control: public, max-age=300, stale-while-revalidate=86400",
    ),
    "# Captions belong to one cut of the episode: short, and never served stale.",
    ...rule("/content/series/:series/captions/*", "Cache-Control: public, max-age=300"),
    "# The catalog points at the current encodes: a minute at most.",
    ...rule("/catalog/*", "Cache-Control: public, max-age=60"),
    ...rule("/icons/*", "Cache-Control: public, max-age=86400"),
    "# The browser must see a new worker at the next open.",
    ...rule("/sw.js", "Cache-Control: no-cache"),
    "# Every video file, poster and caption: never a document.",
    ...rule("/content/*"),
  ];
  const missing = DOCUMENT_ONLY_PATHS.filter((pattern) => !seen.has(pattern));
  if (missing.length > 0) throw new Error(`_headers: no rule for ${missing.join(", ")}`);
  return lines.join("\n");
}

/** Headers that only mean something on a page (or a worker script). */
export const DOCUMENT_ONLY_HEADERS = ["Content-Security-Policy", "X-Frame-Options", "Permissions-Policy"];
/** Paths that never serve a page or a worker script. */
export const DOCUMENT_ONLY_PATHS = ["/_next/static/*", "/content/*", "/catalog/*"];

/**
 * robots.txt. While closed it lets every crawler in ON PURPOSE: what keeps
 * the beta out of search is the noindex every page and every response
 * carries (meta robots and X-Robots-Tag), and a crawler only obeys a noindex
 * it has fetched. A `Disallow: /` would keep it from ever reading one, and a
 * watch link a tester shares in public could still be listed as a bare
 * address from the link alone (Google documents the conflict: "noindex"
 * is ineffective on a page robots.txt blocks). Link previews keep working
 * for the same reason. The closed and the public file differ by the sitemap
 * only; the switch that opens the site is the noindex, taken off by
 * FLOW_PUBLIC=1.
 */
export function robotsTxt({ indexable, siteUrl }) {
  if (indexable) {
    return ["User-agent: *", "Allow: /", "", `Sitemap: ${siteUrl}/sitemap.xml`, ""].join("\n");
  }
  return [
    "# Closed beta (FLOW_PUBLIC unset): every page and every file says noindex, in the",
    "# page and in the X-Robots-Tag header. Crawlers may read them, so they see it: one",
    "# kept out by robots.txt never reads a noindex and can still list a shared link.",
    "# No sitemap until the site is public.",
    "User-agent: *",
    "Allow: /",
    "",
  ].join("\n");
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pages the platform itself owns: never search results, whatever the switch. */
export const ALWAYS_NOINDEX = new Set(["404.html", "offline.html", "offline-shell.html"]);

/** "watch/s/episode-1.html" → "/watch/s/episode-1"; "index.html" → "/". */
export function routeOf(rel) {
  const path = rel.split("\\").join("/").replace(/\.html$/, "");
  return path === "index" ? "/" : `/${path}`;
}

/**
 * Every page a public launch offers to search engines: the feed, every
 * episode, every series page, and the pages we wrote for people to find
 * (stories, for-studios) — everything except the ones that are noindex
 * whatever the switch says.
 *
 * The writer (scripts/finish-export.mjs) and the check
 * (scripts/lib/platform-checks.mjs) both call this, so a new kind of page
 * cannot end up in one and not the other — which is how a page nobody can
 * find gets built and nobody notices.
 */
export function indexableRoutes(pageNames) {
  return pageNames
    .map((name) => name.split("\\").join("/"))
    .filter((name) => !ALWAYS_NOINDEX.has(name))
    .map(routeOf)
    .sort();
}

/** Only for a public launch: every indexable page (indexableRoutes). */
export function sitemapXml(siteUrl, paths) {
  const urls = paths.map((path) => `  <url><loc>${escapeXml(`${siteUrl}${path}`)}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

/** Executable inline scripts of a page, as the browser hashes them. */
export function inlineScripts(html) {
  const scripts = [];
  for (const match of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1] ?? "";
    if (/\ssrc\s*=/i.test(attributes)) continue;
    const type = /\stype\s*=\s*"([^"]*)"/i.exec(attributes)?.[1]?.toLowerCase() ?? "";
    if (type && type !== "text/javascript" && type !== "module") continue;
    scripts.push(match[2]);
  }
  return scripts;
}

export function scriptHash(text) {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

const META_POLICY = /<meta http-equiv="Content-Security-Policy" content="[^"]*"\/>/;

/**
 * The meta policy a page must carry: its own inline scripts, by hash, and
 * the workers the header already allows. The browser enforces this policy
 * and the header's, each on its own; without its own worker-src this one
 * would fall back to its script-src and refuse the blob: worker hls.js starts
 * when it runs its transmuxer off the main thread (not with hls.js/light as
 * the app imports it today, but the day the full build or workerPath is used).
 */
export const META_WORKER_SRC = "worker-src 'self' blob:";

export function scriptPolicyFor(html) {
  const hashes = [...new Set(inlineScripts(html).map(scriptHash))];
  return `${["script-src 'self'", ...hashes].join(" ")}; ${META_WORKER_SRC}`;
}

/**
 * The page with its meta policy placed right after the charset, before any
 * script the policy must cover. Idempotent: a policy already there is
 * replaced by the one the page needs now.
 */
export function withScriptPolicy(html) {
  const stripped = html.replace(META_POLICY, "");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${scriptPolicyFor(stripped)}"/>`;
  const charset = /<meta charSet="utf-8"\/>/i;
  if (charset.test(stripped)) return stripped.replace(charset, (tag) => `${tag}${meta}`);
  return stripped.replace(/<head>/i, (tag) => `${tag}${meta}`);
}

/** The meta policy a page carries, or null. */
export function metaScriptPolicy(html) {
  return /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\/>/.exec(html)?.[1] ?? null;
}

/**
 * The offline page as the worker serves it: without the app's scripts, which
 * would take over the address the viewer asked for, and with offline.js, which
 * reloads it.
 */
export function offlineShell(offlineHtml) {
  return offlineHtml
    .replace(/<script(\s[^>]*)?>[\s\S]*?<\/script>/gi, "")
    .replace(/<link rel="preload" as="script"[^>]*\/>/gi, "")
    .replace(/<link rel="modulepreload"[^>]*\/>/gi, "")
    .replace(/<\/head>/i, '<script src="/offline.js" defer=""></script></head>');
}

/** Same-origin files a page needs to draw: styles, fonts, images, scripts. */
export function staticAssetsOf(html) {
  const found = new Set();
  for (const match of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
    const path = match[1].split("?")[0];
    if (path.startsWith("/_next/static/") || path === "/offline.js") found.add(path);
  }
  return [...found];
}

/** Font and image files a stylesheet names, resolved against its own path. */
export function cssAssetsOf(cssPath, cssText) {
  const found = new Set();
  const base = new URL(cssPath, "https://site.invalid");
  for (const match of cssText.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    if (match[1].startsWith("data:")) continue;
    const url = new URL(match[1], base);
    if (url.origin === base.origin) found.add(url.pathname);
  }
  return [...found];
}

/** The worker for this build: its version and the files of the offline shell. */
export function serviceWorkerSource(template, { version, precache }) {
  const source = template
    .replace('"__FLOW_SW_VERSION__"', JSON.stringify(version))
    .replace('["__FLOW_SW_PRECACHE__"]', JSON.stringify(precache));
  if (source.includes("__FLOW_SW_")) throw new Error("service worker template placeholder left unfilled");
  return source;
}

/**
 * FLOW_SERVICE_WORKER=off: a worker whose only job is to leave. It clears
 * this site's caches and unregisters itself; the browser picks it up at the
 * next open, as it would any new worker.
 */
export const RETIRING_SERVICE_WORKER = [
  "/* Retires the service worker (FLOW_SERVICE_WORKER=off, docs/deploy.md). */",
  'self.addEventListener("install", () => self.skipWaiting());',
  'self.addEventListener("activate", (event) => {',
  "  event.waitUntil(",
  "    (async () => {",
  "      for (const name of await caches.keys()) {",
  '        if (name.startsWith("flow-")) await caches.delete(name);',
  "      }",
  "      await self.registration.unregister();",
  "    })(),",
  "  );",
  "});",
  "",
].join("\n");

/** A short, stable version: the same inputs give the same worker, byte for byte. */
export function buildVersion(parts) {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 12);
}
