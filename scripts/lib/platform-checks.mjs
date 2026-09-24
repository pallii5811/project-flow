/**
 * What `npm run export:web` refuses about the platform around the pages
 * (scripts/deploy-checks.mjs). Pure: it reads a description of the export,
 * so test/platform.test.ts can break each rule on purpose.
 *
 * The export is described by:
 *   pages      Map<relative path, html>   every .html file ("watch/s/episode-1.html")
 *   files      every file of the export, as relative paths
 *   text(rel)  the text of another file, or null when it is not there
 *   size(rel)  the byte size of a file, or null
 *   pngSize(rel) {width, height} of a PNG, or null
 */
import { headersFor, parseHeadersFile } from "./pages-headers.mjs";
import {
  ALWAYS_NOINDEX,
  IMMUTABLE,
  indexableRoutes,
  metaScriptPolicy,
  routeOf,
  scriptPolicyFor,
} from "./platform.mjs";

// Re-exported: test/platform.test.ts and the export check read it from here.
export { routeOf };

function meta(html, key) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]*)"`, "g");
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

function titleOf(html) {
  return /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null;
}

function decode(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Paths whose Cache-Control the export must get right, and what it must be. */
const CACHE_EXPECTATIONS = [
  ["/", /^public, max-age=0, must-revalidate$/],
  ["/watch/signal-night/episode-1", /^public, max-age=0, must-revalidate$/],
  ["/_next/static/chunks/main.js", new RegExp(`^${IMMUTABLE}$`)],
  ["/_next/static/media/font.woff2", new RegExp(`^${IMMUTABLE}$`)],
  ["/content/series/s/hls/episode-1/0123456789ab/master.m3u8", new RegExp(`^${IMMUTABLE}$`)],
  ["/content/series/s/hls/episode-1/0123456789ab/v0/seg_000.m4s", new RegExp(`^${IMMUTABLE}$`)],
  // A playlist outside a revision folder could be rewritten in place: never for a year.
  ["/content/series/s/hls/episode-1/master.m3u8", /^(?!.*immutable)(?!.*max-age=\d{5,})/],
  ["/content/series/s/posters/episode-1.webp", /^public, max-age=\d{1,4}(, stale-while-revalidate=\d+)?$/],
  ["/content/series/s/captions/episode-1.en.vtt", /^public, max-age=\d{1,4}$/],
  ["/catalog/feed.json", /^public, max-age=\d{1,3}$/],
  ["/sw.js", /^no-cache$/],
];

const SECURITY_HEADERS = [
  ["content-security-policy", /frame-ancestors 'none'/],
  ["content-security-policy", /worker-src[^;]*blob:/],
  ["content-security-policy", /media-src[^;]*blob:/],
  ["content-security-policy", /object-src 'none'/],
  ["x-content-type-options", /^nosniff$/],
  ["x-frame-options", /^DENY$/],
  ["referrer-policy", /^(strict-origin-when-cross-origin|strict-origin|same-origin|no-referrer)$/],
  ["permissions-policy", /camera=\(\)/],
  ["strict-transport-security", /max-age=\d{7,}/],
];

/**
 * Where HLS may sit: inside a revision folder named by its files
 * (hls/episode-N/<12 hex>/...), or the packaging record next to it. Anything
 * else could be rewritten under the same URL while browsers keep it a year.
 */
const HLS_FILE = /^content\/series\/[^/]+\/hls\//;
const HLS_ALLOWED = /^content\/series\/[^/]+\/hls\/[^/]+\/(manifest\.json|[0-9a-f]{12}\/.+)$/;

export function platformProblems({
  pages,
  files = [],
  text,
  size,
  pngSize,
  indexable,
  site,
  brand,
  serviceWorkerOn,
}) {
  const problems = [];
  const fail = (message) => problems.push(message);

  // --- HLS only under a revision: cached for a year, so never rewritten ------
  const strayHls = files
    .map((rel) => rel.split("\\").join("/"))
    .filter((rel) => HLS_FILE.test(rel) && !HLS_ALLOWED.test(rel));
  if (strayHls.length > 0) {
    fail(
      `${strayHls.length} HLS file(s) outside a revision folder, cached for a year under a URL that can change: ` +
        strayHls.slice(0, 3).join(", "),
    );
  }

  // --- _headers: caching and security, the way Pages will read them ---------
  const headersText = text("_headers");
  let rules = [];
  if (headersText === null) {
    fail("export has no _headers: no caching rules, no security headers (speed-3, MP-6)");
  } else {
    const parsed = parseHeadersFile(headersText);
    rules = parsed.rules;
    for (const problem of parsed.problems) fail(`_headers: ${problem}`);
    for (const [path, expected] of CACHE_EXPECTATIONS) {
      const value = headersFor(rules, path)["cache-control"] ?? "(Pages default)";
      if (!expected.test(value)) fail(`_headers: ${path} gets Cache-Control "${value}"`);
    }
    for (const route of [...pages.keys()].map(routeOf)) {
      const headers = headersFor(rules, route);
      for (const [name, expected] of SECURITY_HEADERS) {
        if (!expected.test(headers[name] ?? "")) {
          fail(`_headers: ${route} has no ${name} matching ${expected}`);
          break;
        }
      }
    }
  }

  // --- the closed-beta switch: every signal must say the same thing ---------
  const robots = text("robots.txt");
  const sitemap = text("sitemap.xml");
  const noindexHeader = /noindex/i.test(headersFor(rules, "/")["x-robots-tag"] ?? "");
  if (robots === null) fail("export has no robots.txt");
  const starGroup = robots
    ? (robots.split(/\n\s*\n/).find((group) => /^User-agent:\s*\*\s*$/im.test(group)) ?? "")
    : "";
  const disallowsAll = /^Disallow:\s*\/\s*$/im.test(starGroup);
  if (indexable) {
    if (noindexHeader) fail("FLOW_PUBLIC=1 but _headers sends X-Robots-Tag: noindex");
    if (disallowsAll) fail("FLOW_PUBLIC=1 but robots.txt disallows every crawler");
    if (sitemap === null) fail("FLOW_PUBLIC=1 but the export has no sitemap.xml");
    else {
      const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decode(match[1]));
      // Every page that is not noindex by nature, the same list the writer
      // built (platform.mjs): a series page nobody can find is a page we did
      // not build.
      const expected = indexableRoutes([...pages.keys()]).map((route) => `${site}${route}`);
      const missing = expected.filter((url) => !locs.includes(url));
      const extra = locs.filter((url) => !expected.includes(url));
      if (missing.length > 0) fail(`sitemap.xml misses ${missing.length} page(s): ${missing.slice(0, 3).join(", ")}`);
      if (extra.length > 0) fail(`sitemap.xml lists what is not a page of ${site}: ${extra.slice(0, 3).join(", ")}`);
    }
    if (!robots?.includes(`Sitemap: ${site}/sitemap.xml`)) fail("robots.txt does not name the sitemap");
  } else {
    if (!noindexHeader) fail("closed beta but _headers sends no X-Robots-Tag: noindex");
    // A crawler kept out never reads the noindex, and can still list a shared link.
    if (disallowsAll) fail("closed beta but robots.txt disallows every crawler, so none can read the noindex");
    if (sitemap !== null) fail("closed beta but the export carries a sitemap.xml");
    if (robots && /^Sitemap:/im.test(robots)) fail("closed beta but robots.txt names a sitemap");
  }
  for (const [rel, html] of pages) {
    const noindex = meta(html, "robots").some((value) => /noindex/i.test(value));
    const always = ALWAYS_NOINDEX.has(rel.split("\\").join("/"));
    if ((!indexable || always) && !noindex) fail(`${rel} has no meta robots noindex`);
    if (indexable && !always && noindex) fail(`FLOW_PUBLIC=1 but ${rel} says noindex`);
  }

  // --- every inline script is one the page was built with -------------------
  for (const [rel, html] of pages) {
    const policy = metaScriptPolicy(html);
    if (policy === null) fail(`${rel} carries no script policy (finish-export did not run)`);
    else {
      if (policy !== scriptPolicyFor(html)) fail(`${rel}: its script policy does not match its inline scripts`);
      // Both policies apply: the page's own must not refuse what the header allows hls.js.
      if (!/(^|;)\s*worker-src [^;]*blob:/.test(policy)) {
        fail(`${rel}: its meta policy has no worker-src with blob:, so hls.js could not start its worker`);
      }
    }
  }

  // --- installable: manifest and icons ---------------------------------------
  let manifest = null;
  try {
    manifest = JSON.parse(text("manifest.webmanifest") ?? "null");
  } catch {
    fail("manifest.webmanifest is not JSON");
  }
  if (!manifest) fail("export has no manifest.webmanifest");
  else {
    if (manifest.name !== brand || manifest.short_name !== brand) {
      fail(`manifest names "${manifest.name}" / "${manifest.short_name}", not ${brand}`);
    }
    if (manifest.display !== "standalone") fail(`manifest display is ${manifest.display}`);
    if (typeof manifest.start_url !== "string" || !manifest.start_url.startsWith("/")) {
      fail(`manifest start_url is ${manifest.start_url}`);
    }
    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    for (const [sizes, purpose] of [
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ]) {
      const icon = icons.find((entry) => entry.sizes === sizes && entry.purpose === purpose);
      if (!icon) {
        fail(`manifest has no ${sizes} ${purpose} icon`);
        continue;
      }
      const real = pngSize(icon.src.replace(/^\//, ""));
      const [width, height] = sizes.split("x").map(Number);
      if (!real) fail(`manifest icon ${icon.src} is not a PNG in the export`);
      else if (real.width !== width || real.height !== height) {
        fail(`manifest icon ${icon.src} is ${real.width}x${real.height}, declared ${sizes}`);
      }
    }
  }
  if (!pngSize("apple-icon.png")) fail("export has no apple-icon.png (Add to Home Screen on iOS)");

  // --- the service worker keeps no media, no catalog, no page ---------------
  const worker = text("sw.js");
  if (worker === null) fail("export has no sw.js");
  else if (serviceWorkerOn) {
    const list = /const PRECACHE = (\[[^\]]*\]);/.exec(worker)?.[1];
    let precache = null;
    try {
      precache = JSON.parse(list ?? "null");
    } catch {
      precache = null;
    }
    if (!Array.isArray(precache)) fail("sw.js carries no precache list");
    else {
      for (const path of precache) {
        if (/^\/(content|catalog|watch)\//.test(path) || /\.(m3u8|m4s|mp4|webp|jpg|vtt|json)$/.test(path)) {
          fail(`sw.js precaches ${path}: media, catalog and pages are never cached`);
        }
        const rel = path.slice(1);
        if (size(rel) === null && size(`${rel}.html`) === null) {
          fail(`sw.js precaches ${path}, which is not in the export: the worker would never install`);
        }
      }
    }
  } else if (!/unregister\(\)/.test(worker)) {
    fail("FLOW_SERVICE_WORKER=off but sw.js does not retire the worker");
  }

  // --- the brand reaches every page, and every episode page is its own ------
  const titles = new Map();
  for (const [rel, html] of pages) {
    const title = decode(titleOf(html) ?? "");
    if (title !== brand && !title.endsWith(` · ${brand}`)) fail(`${rel} is titled "${title}", without ${brand}`);
    for (const siteName of meta(html, "og:site_name")) {
      if (decode(siteName) !== brand) fail(`${rel} og:site_name is "${siteName}"`);
    }
    if (!rel.split("\\").join("/").startsWith("watch/")) continue;
    if (titles.has(title)) fail(`${rel} has the same title as ${titles.get(title)}: "${title}"`);
    titles.set(title, rel);
    if (meta(html, "og:type")[0] !== "video.episode") fail(`${rel} og:type is not video.episode`);
    if (meta(html, "og:site_name").length === 0) fail(`${rel} has no og:site_name`);
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    if (canonical !== `${site}${routeOf(rel)}`) fail(`${rel} canonical is ${canonical}`);
  }

  return problems;
}

/** Cloudflare Pages limits on one deployment (free plan). */
export const PAGES_MAX_FILES = 20_000;
export const PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024;

export function pagesLimitProblems(fileSizes) {
  const problems = [];
  if (fileSizes.size > PAGES_MAX_FILES) {
    problems.push(`${fileSizes.size} files: Cloudflare Pages takes at most ${PAGES_MAX_FILES} per deploy`);
  }
  for (const [rel, bytes] of fileSizes) {
    if (bytes > PAGES_MAX_FILE_BYTES) problems.push(`${rel} is ${bytes} B: Pages refuses files over 25 MiB`);
  }
  return problems;
}
