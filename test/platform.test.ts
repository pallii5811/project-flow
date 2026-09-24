/**
 * The platform around the pages (batch 5): the _headers file as Cloudflare
 * Pages reads it, the closed-beta switch, the service worker and the export
 * check that refuses a wrong export. Every rule of the check is broken on
 * purpose here: a check that has never failed is not a check.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { headersFor, parseHeadersFile, patternToRegExp } from "../scripts/lib/pages-headers.mjs";
import { pagesLimitProblems, platformProblems, routeOf } from "../scripts/lib/platform-checks.mjs";
import {
  IMMUTABLE,
  RETIRING_SERVICE_WORKER,
  buildVersion,
  contentSecurityPolicy,
  cssAssetsOf,
  headersFile,
  inlineScripts,
  metaScriptPolicy,
  offlineShell,
  robotsTxt,
  scriptHash,
  scriptPolicyFor,
  serviceWorkerSource,
  sitemapXml,
  staticAssetsOf,
  withScriptPolicy,
} from "../scripts/lib/platform.mjs";
import { encodeRevision } from "../scripts/lib/delivery-rules.mjs";

const SITE = "https://cliffies.example";
const BRAND = "Cliffies";
const WORKER_TEMPLATE = readFileSync(resolve(__dirname, "../scripts/lib/service-worker.js"), "utf8");

describe("the _headers format, read as Pages reads it", () => {
  it("matches splats across slashes and placeholders within one segment", () => {
    expect(patternToRegExp("/_next/static/*").test("/_next/static/chunks/a/b.js")).toBe(true);
    const hls = patternToRegExp("/content/series/:series/hls/:episode/:revision/*");
    expect(hls.test("/content/series/s/hls/episode-1/0123456789ab/v0/seg_000.m4s")).toBe(true);
    expect(hls.test("/content/series/s/hls/episode-1/master.m3u8")).toBe(false);
    expect(patternToRegExp("/").test("/watch")).toBe(false);
    expect(patternToRegExp("/sw.js").test("/swxjs")).toBe(false);
  });

  it("joins a header two rules set, and lets ! remove one", () => {
    const { rules, problems } = parseHeadersFile(
      ["/*", "  X-A: one", "  Cache-Control: no-store", "/a/*", "  X-A: two", "  ! Cache-Control", ""].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(headersFor(rules, "/a/b")).toEqual({ "x-a": "one, two" });
    expect(headersFor(rules, "/b")).toEqual({ "x-a": "one", "cache-control": "no-store" });
  });

  it("keeps one rule per pattern, as Pages does: the last one written, in the place of the first", () => {
    // The shape that cost every chunk its year of cache (review R5-1).
    const text = [
      "/*",
      "  Content-Security-Policy: default-src 'self'",
      "  X-Content-Type-Options: nosniff",
      "/_next/static/*",
      "  Cache-Control: public, max-age=31536000, immutable",
      "/sw.js",
      "  Cache-Control: no-cache",
      "/_next/static/*",
      "  ! Content-Security-Policy",
      "",
    ].join("\n");
    const { rules, problems } = parseHeadersFile(text);
    expect(problems.join()).toMatch(/"\/_next\/static\/\*" is written on line 4 and again on line 8: Pages keeps only the rule on line 8, and drops Cache-Control/);
    expect(rules.map((rule) => rule.pattern)).toEqual(["/*", "/_next/static/*", "/sw.js"]);
    expect(headersFor(rules, "/_next/static/a.js")).toEqual({ "x-content-type-options": "nosniff" });
    // With Pages' own Cache-Control underneath, what a phone would get.
    expect(headersFor(rules, "/_next/static/a.js", { "Cache-Control": "public, max-age=0, must-revalidate" })).toEqual({
      "cache-control": "public, max-age=0, must-revalidate",
      "x-content-type-options": "nosniff",
    });
  });

  it("applies rules in the order of the file: a removal takes out only what came before it", () => {
    const { rules } = parseHeadersFile(
      ["/a/*", "  ! X-B", "  X-A: one", "/*", "  X-B: two", "  X-A: two", ""].join("\n"),
    );
    expect(headersFor(rules, "/a/b")).toEqual({ "x-a": "one, two", "x-b": "two" });
    expect(headersFor(rules, "/a/b", { "cache-control": "base" })).toMatchObject({ "cache-control": "base" });
  });

  it("reports what Pages would refuse", () => {
    expect(parseHeadersFile("/a\n  !X-A\n").problems.join()).toMatch(/not "Name: value"/);
    expect(parseHeadersFile("/a/*/b/*\n  X: y\n").problems.join()).toMatch(/more than one splat/);
    expect(parseHeadersFile("  X: y\n").problems.join()).toMatch(/before any URL pattern/);
    expect(parseHeadersFile(`/a\n  X: ${"y".repeat(2_001)}\n`).problems.join()).toMatch(/characters/);
    expect(parseHeadersFile("/a\n  nonsense\n").problems.join()).toMatch(/not "Name: value"/);
  });
});

describe("what the export sends", () => {
  const rules = parseHeadersFile(headersFile({ indexable: false })).rules;
  const cache = (path: string) => headersFor(rules, path)["cache-control"];

  it("writes each pattern once, so Pages reads what is written", () => {
    for (const indexable of [false, true]) {
      const text = headersFile({ indexable });
      expect(parseHeadersFile(text).problems).toEqual([]);
      const patterns = text.split("\n").filter((line) => line.startsWith("/"));
      expect(new Set(patterns).size).toBe(patterns.length);
    }
    // The page-only headers are taken off inside the rule that caches for a year.
    expect(headersFile({ indexable: false })).toContain(
      `/_next/static/*\n  Cache-Control: ${IMMUTABLE}\n  ! Content-Security-Policy\n  ! X-Frame-Options\n  ! Permissions-Policy\n`,
    );
  });

  it("caches for a year only what never changes", () => {
    expect(cache("/_next/static/chunks/main-abc.js")).toBe(IMMUTABLE);
    expect(cache("/_next/static/media/font.p.woff2")).toBe(IMMUTABLE);
    expect(cache("/content/series/s/hls/episode-1/0123456789ab/master.m3u8")).toBe(IMMUTABLE);
    expect(cache("/content/series/s/hls/episode-1/0123456789ab/v2/seg_004.m4s")).toBe(IMMUTABLE);
  });

  it("asks again for pages, and keeps playlists outside a revision, posters, captions and the catalog short", () => {
    expect(cache("/")).toBe("public, max-age=0, must-revalidate");
    expect(cache("/watch/s/episode-1")).toBe("public, max-age=0, must-revalidate");
    expect(cache("/content/series/s/hls/episode-1/master.m3u8")).toBeUndefined();
    expect(cache("/content/series/s/posters/episode-1.webp")).toMatch(/^public, max-age=300\b/);
    expect(cache("/content/series/s/captions/episode-1.en.vtt")).toBe("public, max-age=300");
    expect(cache("/catalog/feed.json")).toBe("public, max-age=60");
    expect(cache("/sw.js")).toBe("no-cache");
  });

  it("never sets Cache-Control twice on one path", () => {
    for (const path of ["/", "/watch/s/e", "/_next/static/a.js", "/catalog/feed.json", "/sw.js"]) {
      expect(cache(path)).not.toMatch(/,.*max-age.*,.*max-age/);
      expect((cache(path) ?? "").split("max-age").length).toBeLessThanOrEqual(2);
    }
  });

  it("keeps document-only headers off files that are never a document", () => {
    for (const path of [
      "/_next/static/chunks/a.js",
      "/content/series/s/hls/episode-1/0123456789ab/v0/seg_000.m4s",
      "/content/series/s/posters/e.webp",
      "/catalog/feed.json",
    ]) {
      const headers = headersFor(rules, path);
      expect(headers["content-security-policy"]).toBeUndefined();
      expect(headers["x-frame-options"]).toBeUndefined();
      expect(headers["permissions-policy"]).toBeUndefined();
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["strict-transport-security"]).toMatch(/max-age=31536000/);
      expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
  });

  it("sends every security header on pages, the 404 of any path, and the worker", () => {
    for (const path of ["/", "/watch/s/e", "/offline", "/no-such-page", "/sw.js"]) {
      const headers = headersFor(rules, path);
      expect(headers["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"]).toMatch(/camera=\(\), microphone=\(\), geolocation=\(\)/);
      expect(headers["strict-transport-security"]).toMatch(/max-age=31536000/);
    }
  });

  it("says noindex in the headers only while the beta is closed", () => {
    expect(headersFor(rules, "/")["x-robots-tag"]).toBe("noindex, nofollow");
    const open = parseHeadersFile(headersFile({ indexable: true })).rules;
    expect(headersFor(open, "/")["x-robots-tag"]).toBeUndefined();
  });
});

describe("the content security policy", () => {
  it("lets hls.js work: a worker and media from blob:", () => {
    const policy = contentSecurityPolicy();
    expect(policy).toMatch(/worker-src 'self' blob:/);
    expect(policy).toMatch(/media-src 'self' blob:/);
    expect(policy).toMatch(/object-src 'none'/);
    expect(policy).not.toMatch(/https?:/);
  });

  it("adds the media host and the collector by origin, and ignores what is not a URL", () => {
    const policy = contentSecurityPolicy({
      mediaBaseUrl: "https://media.cliffies.example/v1/",
      analyticsEndpoint: "https://collect.cliffies.example/e",
    });
    expect(policy).toMatch(/media-src 'self' blob: https:\/\/media\.cliffies\.example;/);
    expect(policy).toMatch(/img-src [^;]*https:\/\/media\.cliffies\.example/);
    expect(policy).toMatch(/connect-src 'self' https:\/\/collect\.cliffies\.example https:\/\/media\.cliffies\.example;/);
    expect(contentSecurityPolicy({ mediaBaseUrl: "javascript:alert(1)" })).not.toMatch(/javascript/);
  });

  it("lists each inline script of a page by hash, and only those", () => {
    const html = '<html><head><meta charSet="utf-8"/></head><body><script>a()</script><script src="/x.js"></script><script type="application/ld+json">{}</script><script>b()</script></body></html>';
    expect(inlineScripts(html)).toEqual(["a()", "b()"]);
    const withPolicy = withScriptPolicy(html);
    expect(metaScriptPolicy(withPolicy)).toBe(
      `script-src 'self' ${scriptHash("a()")} ${scriptHash("b()")}; worker-src 'self' blob:`,
    );
    // The policy sits before the first script it covers.
    expect(withPolicy.indexOf("Content-Security-Policy")).toBeLessThan(withPolicy.indexOf("<script>"));
    // Idempotent: a second pass replaces, never stacks.
    expect(withScriptPolicy(withPolicy)).toBe(withPolicy);
    expect(scriptPolicyFor(withPolicy)).toBe(metaScriptPolicy(withPolicy));
  });
});

describe("the closed-beta switch in robots.txt and the sitemap", () => {
  it("lets crawlers read the noindex while closed, and names no sitemap", () => {
    // A crawler kept out by Disallow never reads the noindex (review R5-3);
    // the pages and the X-Robots-Tag header are what keep the beta out.
    const robots = robotsTxt({ indexable: false, siteUrl: SITE });
    expect(robots).toMatch(/User-agent: \*\nAllow: \/\n/);
    expect(robots).not.toMatch(/Disallow/);
    expect(robots).not.toMatch(/Sitemap:/);
    expect(headersFor(parseHeadersFile(headersFile({ indexable: false })).rules, "/watch/s/e")["x-robots-tag"]).toBe(
      "noindex, nofollow",
    );
  });

  it("opens everything and names the sitemap when public", () => {
    const robots = robotsTxt({ indexable: true, siteUrl: SITE });
    expect(robots).toMatch(/User-agent: \*\nAllow: \//);
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(robots).not.toMatch(/Disallow/);
    const sitemap = sitemapXml(SITE, ["/", "/watch/s/a&b"]);
    expect(sitemap).toContain(`<loc>${SITE}/</loc>`);
    expect(sitemap).toContain(`<loc>${SITE}/watch/s/a&amp;b</loc>`);
  });
});

describe("the service worker", () => {
  it("is written with its version and its shell, and nothing left unfilled", () => {
    const source = serviceWorkerSource(WORKER_TEMPLATE, {
      version: "0123456789ab",
      precache: ["/offline-shell", "/offline.js"],
    });
    expect(source).toContain('const VERSION = "0123456789ab";');
    expect(source).toContain('const PRECACHE = ["/offline-shell","/offline.js"];');
    expect(source).not.toContain("__FLOW_SW_");
    expect(() => serviceWorkerSource("nothing to fill", { version: "x", precache: [] })).not.toThrow();
    expect(() =>
      serviceWorkerSource('const VERSION = "__FLOW_SW_VERSION__"; "__FLOW_SW_OTHER__"', {
        version: "x",
        precache: [],
      }),
    ).toThrow(/placeholder/);
  });

  it("answers pages from the network first and never touches media or the catalog", () => {
    expect(WORKER_TEMPLATE).toMatch(/request\.mode === "navigate"[\s\S]*networkFirstPage/);
    expect(WORKER_TEMPLATE).toMatch(/url\.pathname\.startsWith\("\/_next\/static\/"\)/);
    // The only cache writes are the precache and hashed static files.
    expect(WORKER_TEMPLATE.match(/cache\.put\(/g)).toHaveLength(1);
    expect(WORKER_TEMPLATE).not.toMatch(/\/content\/|\/catalog\/|m3u8|m4s/);
  });

  it("gets a new version for a new build, and the same one for the same build", () => {
    expect(buildVersion(["build-a", "/offline-shell"])).toBe(buildVersion(["build-a", "/offline-shell"]));
    expect(buildVersion(["build-a"])).not.toBe(buildVersion(["build-b"]));
    expect(buildVersion(["x"])).toMatch(/^[0-9a-f]{12}$/);
  });

  it("can be retired by a deploy", () => {
    expect(RETIRING_SERVICE_WORKER).toMatch(/unregister\(\)/);
    expect(RETIRING_SERVICE_WORKER).toMatch(/caches\.delete/);
  });

  it("builds an offline shell without the app's scripts, and knows the files it needs", () => {
    const offline =
      '<html><head><meta charSet="utf-8"/><link rel="stylesheet" href="/_next/static/css/a.css"/><link rel="preload" as="script" href="/_next/static/chunks/x.js"/></head><body><main data-offline-page="true"></main><script src="/_next/static/chunks/x.js"></script><script>self.__next_f.push(1)</script></body></html>';
    const shell = offlineShell(offline);
    expect(shell).not.toMatch(/chunks\/x\.js|__next_f/);
    expect(shell).toContain('<script src="/offline.js" defer=""></script></head>');
    expect(staticAssetsOf(shell)).toEqual(["/_next/static/css/a.css", "/offline.js"]);
    expect(
      cssAssetsOf("/_next/static/css/a.css", "@font-face{src:url(../media/f.p.woff2)}a{b:url(data:x)}"),
    ).toEqual(["/_next/static/media/f.p.woff2"]);
  });
});

describe("the name of an encode (a new cut is a new URL)", () => {
  it("depends on every file and byte, not on the order they were listed", () => {
    const files: [string, string][] = [
      ["master.m3u8", "aa"],
      ["v0/seg_000.m4s", "bb"],
    ];
    const name = encodeRevision(files);
    expect(name).toMatch(/^[0-9a-f]{12}$/);
    expect(encodeRevision([...files].reverse())).toBe(name);
    expect(encodeRevision([files[0], ["v0/seg_000.m4s", "bc"]])).not.toBe(name);
    expect(encodeRevision([files[0]])).not.toBe(name);
  });
});

// ---------------------------------------------------------------------------
// The export check, on a small export that is right, then broken rule by rule.

type Fixture = {
  indexable: boolean;
  pages: Map<string, string>;
  texts: Map<string, string>;
  files: string[];
  pngs: Map<string, { width: number; height: number }>;
  serviceWorkerOn: boolean;
};

function htmlPage({
  title,
  robots,
  canonical,
  type,
  siteName = BRAND,
  script = "self.__next_f.push([1])",
}: {
  title: string;
  robots: string | null;
  canonical?: string;
  type?: string;
  siteName?: string;
  script?: string;
}): string {
  return withScriptPolicy(
    [
      '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>',
      `<title>${title}</title>`,
      robots ? `<meta name="robots" content="${robots}"/>` : "",
      `<meta property="og:site_name" content="${siteName}"/>`,
      type ? `<meta property="og:type" content="${type}"/>` : "",
      canonical ? `<link rel="canonical" href="${canonical}"/>` : "",
      `</head><body><script>${script}</script></body></html>`,
    ].join(""),
  );
}

function goodExport(indexable = false): Fixture {
  const robots = indexable ? null : "noindex, nofollow";
  const pages = new Map<string, string>([
    ["index.html", htmlPage({ title: BRAND, robots })],
    ["404.html", htmlPage({ title: `Page not found · ${BRAND}`, robots: "noindex, nofollow" })],
    ["offline.html", htmlPage({ title: `Offline · ${BRAND}`, robots: "noindex, nofollow" })],
    ["offline-shell.html", htmlPage({ title: `Offline · ${BRAND}`, robots: "noindex, nofollow", script: "" })],
    // A page about a series: indexable like the feed and the episodes, and
    // therefore owed a place in the sitemap.
    ["series/s.html", htmlPage({ title: `S · ${BRAND}`, robots, canonical: `${SITE}/series/s` })],
    ...[1, 2].map(
      (n) =>
        [
          `watch/s/episode-${n}.html`,
          htmlPage({
            title: `S · Episode ${n} · ${BRAND}`,
            robots,
            canonical: `${SITE}/watch/s/episode-${n}`,
            type: "video.episode",
          }),
        ] as [string, string],
    ),
  ]);
  const manifest = {
    name: BRAND,
    short_name: BRAND,
    display: "standalone",
    start_url: "/?utm_source=homescreen",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", purpose: "maskable" },
    ],
  };
  const texts = new Map<string, string>([
    ["_headers", headersFile({ indexable })],
    ["robots.txt", robotsTxt({ indexable, siteUrl: SITE })],
    ["manifest.webmanifest", JSON.stringify(manifest)],
    [
      "sw.js",
      serviceWorkerSource(WORKER_TEMPLATE, {
        version: "0123456789ab",
        precache: ["/_next/static/css/a.css", "/offline-shell", "/offline.js"],
      }),
    ],
  ]);
  if (indexable) {
    texts.set(
      "sitemap.xml",
      sitemapXml(SITE, ["/", "/series/s", "/watch/s/episode-1", "/watch/s/episode-2"]),
    );
  }
  return {
    indexable,
    pages,
    texts,
    files: [
      ...pages.keys(),
      ...texts.keys(),
      "_next/static/css/a.css",
      "offline.js",
      "catalog/feed.json",
      "content/series/s/hls/episode-1/manifest.json",
      "content/series/s/hls/episode-1/0123456789ab/master.m3u8",
      "content/series/s/hls/episode-1/0123456789ab/v0/seg_000.m4s",
    ],
    pngs: new Map([
      ["icons/icon-192.png", { width: 192, height: 192 }],
      ["icons/icon-512.png", { width: 512, height: 512 }],
      ["icons/maskable-512.png", { width: 512, height: 512 }],
      ["apple-icon.png", { width: 180, height: 180 }],
    ]),
    serviceWorkerOn: true,
  };
}

function problemsOf(fixture: Fixture): string[] {
  return platformProblems({
    pages: fixture.pages,
    files: fixture.files,
    text: (rel: string) => fixture.texts.get(rel) ?? null,
    size: (rel: string) => (fixture.files.includes(rel) ? 1 : null),
    pngSize: (rel: string) => fixture.pngs.get(rel) ?? null,
    indexable: fixture.indexable,
    site: SITE,
    brand: BRAND,
    serviceWorkerOn: fixture.serviceWorkerOn,
  });
}

function mapPage(fixture: Fixture, rel: string, change: (html: string) => string): Fixture {
  const pages = new Map(fixture.pages);
  pages.set(rel, change(pages.get(rel) ?? ""));
  return { ...fixture, pages };
}

function setText(fixture: Fixture, rel: string, value: string | null): Fixture {
  const texts = new Map(fixture.texts);
  if (value === null) texts.delete(rel);
  else texts.set(rel, value);
  return { ...fixture, texts };
}

describe("the export check", () => {
  it("passes a right export, closed and public", () => {
    expect(problemsOf(goodExport(false))).toEqual([]);
    expect(problemsOf(goodExport(true))).toEqual([]);
    expect(routeOf("index.html")).toBe("/");
    expect(routeOf("watch\\s\\episode-1.html")).toBe("/watch/s/episode-1");
  });

  const good = goodExport(false);
  const headers = good.texts.get("_headers") ?? "";
  const sabotage: [string, () => Fixture, RegExp][] = [
    ["no _headers", () => setText(good, "_headers", null), /no _headers/],
    [
      "HLS revalidated instead of immutable",
      () => setText(good, "_headers", headers.replace(/(hls\/:episode\/:revision\/\*\n\s+Cache-Control: ).*/, "$1public, max-age=0")),
      /hls\/episode-1\/0123456789ab\/master\.m3u8 gets Cache-Control/,
    ],
    [
      "a playlist outside a revision folder cached for a year",
      () => setText(good, "_headers", headers.replace("/:episode/:revision/*", "/*")),
      /hls\/episode-1\/master\.m3u8 gets Cache-Control/,
    ],
    [
      "HLS published outside a revision folder",
      () => ({ ...good, files: [...good.files, "content/series/s/hls/episode-1/master.m3u8"] }),
      /outside a revision folder/,
    ],
    [
      "pages cached",
      () => setText(good, "_headers", headers.replace("/watch/*\n  Cache-Control: public, max-age=0, must-revalidate", "/watch/*\n  Cache-Control: public, max-age=3600")),
      /\/watch\/signal-night\/episode-1 gets Cache-Control/,
    ],
    [
      "the catalog cached for a day",
      () => setText(good, "_headers", headers.replace("public, max-age=60", "public, max-age=86400")),
      /\/catalog\/feed\.json gets Cache-Control/,
    ],
    [
      "the page-only removals in a second /_next/static/* rule (the layout of 6a32609)",
      () =>
        setText(
          good,
          "_headers",
          `${headers.replace(/\n {2}! [^\n]+/g, "")}\n/_next/static/*\n  ! Content-Security-Policy\n/catalog/*\n  ! Content-Security-Policy\n`,
        ),
      /"\/_next\/static\/\*" is written on line \d+ and again[\s\S]*\/_next\/static\/chunks\/main\.js gets Cache-Control "\(Pages default\)"[\s\S]*\/catalog\/feed\.json gets Cache-Control "\(Pages default\)"/,
    ],
    [
      "a page whose own policy refuses the blob: worker",
      () => mapPage(good, "index.html", (html) => html.replace("; worker-src 'self' blob:", "")),
      /index\.html: its meta policy has no worker-src with blob:/,
    ],
    [
      "Cache-Control set by /* too",
      () => setText(good, "_headers", headers.replace("  X-Content-Type-Options: nosniff", "  X-Content-Type-Options: nosniff\n  Cache-Control: no-store")),
      /gets Cache-Control "no-store, /,
    ],
    [
      "no frame-ancestors",
      () => setText(good, "_headers", headers.replace("; frame-ancestors 'none'", "")),
      /no content-security-policy matching .*frame-ancestors/,
    ],
    [
      "no blob: worker for hls.js",
      () => setText(good, "_headers", headers.replace("worker-src 'self' blob:", "worker-src 'self'")),
      /worker-src/,
    ],
    ["no nosniff", () => setText(good, "_headers", headers.replace("  X-Content-Type-Options: nosniff\n", "")), /x-content-type-options/],
    ["no HSTS", () => setText(good, "_headers", headers.replace(/ {2}Strict-Transport-Security.*\n/, "")), /strict-transport-security/],
    [
      "closed beta without X-Robots-Tag",
      () => setText(good, "_headers", headers.replace("  X-Robots-Tag: noindex, nofollow\n", "")),
      /no X-Robots-Tag: noindex/,
    ],
    [
      "closed beta with the public robots.txt",
      () => setText(good, "robots.txt", robotsTxt({ indexable: true, siteUrl: SITE })),
      /closed beta but robots\.txt names a sitemap/,
    ],
    [
      "closed beta whose robots.txt keeps every crawler from reading the noindex (review R5-3)",
      () => setText(good, "robots.txt", "User-agent: WhatsApp\nAllow: /\n\nUser-agent: *\nDisallow: /\n"),
      /closed beta but robots\.txt disallows every crawler, so none can read the noindex/,
    ],
    [
      "closed beta with a sitemap",
      () => setText(good, "sitemap.xml", sitemapXml(SITE, ["/"])),
      /carries a sitemap\.xml/,
    ],
    [
      "closed beta with a page that may be indexed",
      () => mapPage(good, "watch/s/episode-2.html", (html) => html.replace('<meta name="robots" content="noindex, nofollow"/>', "")),
      /episode-2\.html has no meta robots noindex/,
    ],
    [
      "an inline script the policy does not list",
      () => mapPage(good, "index.html", (html) => html.replace("push([1])", "push([2])")),
      /index\.html: its script policy does not match/,
    ],
    [
      "a page without its script policy",
      () => mapPage(good, "index.html", (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*\/>/, "")),
      /carries no script policy/,
    ],
    [
      "the manifest under another name",
      () => setText(good, "manifest.webmanifest", (good.texts.get("manifest.webmanifest") ?? "").replace(/"Cliffies"/g, '"Project Flow"')),
      /manifest names "Project Flow"/,
    ],
    [
      "the manifest not standalone",
      () => setText(good, "manifest.webmanifest", (good.texts.get("manifest.webmanifest") ?? "").replace("standalone", "browser")),
      /display is browser/,
    ],
    [
      "a maskable icon missing",
      () => setText(good, "manifest.webmanifest", (good.texts.get("manifest.webmanifest") ?? "").replace('"maskable"', '"any"')),
      /no 512x512 maskable icon/,
    ],
    [
      "an icon of the wrong size",
      () => ({ ...good, pngs: new Map([...good.pngs, ["icons/icon-192.png", { width: 180, height: 180 }]]) }),
      /icon-192\.png is 180x180/,
    ],
    [
      "no apple-touch-icon",
      () => ({ ...good, pngs: new Map([...good.pngs].filter(([rel]) => rel !== "apple-icon.png")) }),
      /apple-icon\.png/,
    ],
    [
      "the worker precaches the catalog",
      () => setText(good, "sw.js", serviceWorkerSource(WORKER_TEMPLATE, { version: "x", precache: ["/offline-shell", "/catalog/feed.json"] })),
      /precaches \/catalog\/feed\.json/,
    ],
    [
      "the worker precaches a segment",
      () => setText(good, "sw.js", serviceWorkerSource(WORKER_TEMPLATE, { version: "x", precache: ["/offline-shell", "/content/series/s/hls/episode-1/0123456789ab/v0/seg_000.m4s"] })),
      /precaches \/content\//,
    ],
    [
      "the worker precaches a file the export lacks",
      () => setText(good, "sw.js", serviceWorkerSource(WORKER_TEMPLATE, { version: "x", precache: ["/offline-shell", "/_next/static/css/gone.css"] })),
      /would never install/,
    ],
    [
      "the worker switched off but not retired",
      () => ({ ...good, serviceWorkerOn: false }),
      /does not retire the worker/,
    ],
    [
      "two episodes with the same title",
      () => mapPage(good, "watch/s/episode-2.html", (html) => html.replace("Episode 2", "Episode 1")),
      /same title as/,
    ],
    [
      "an episode page that is not a video.episode",
      () => mapPage(good, "watch/s/episode-1.html", (html) => html.replace("video.episode", "website")),
      /og:type is not video\.episode/,
    ],
    [
      "a canonical on another host",
      () => mapPage(good, "watch/s/episode-1.html", (html) => html.replace(SITE, "https://abc.pages.dev")),
      /canonical is https:\/\/abc\.pages\.dev/,
    ],
    [
      "a page titled without the brand",
      () => mapPage(good, "404.html", (html) => html.replace(`Page not found · ${BRAND}`, "Page not found · PROJECT FLOW")),
      /404\.html is titled .*without Cliffies/,
    ],
    [
      "og:site_name under the old name",
      () => mapPage(good, "index.html", (html) => html.replace(`og:site_name" content="${BRAND}"`, 'og:site_name" content="PROJECT FLOW"')),
      /og:site_name is "PROJECT FLOW"/,
    ],
  ];

  it.each(sabotage)("refuses an export with %s", (_label, make, expected) => {
    const problems = problemsOf(make());
    expect(problems.join("\n")).toMatch(expected);
  });

  const open = goodExport(true);
  const publicSabotage: [string, () => Fixture, RegExp][] = [
    [
      "FLOW_PUBLIC=1 with noindex in the headers",
      () => setText(open, "_headers", headersFile({ indexable: false })),
      /sends X-Robots-Tag: noindex/,
    ],
    [
      "FLOW_PUBLIC=1 with the closed-beta robots.txt",
      () => setText(open, "robots.txt", robotsTxt({ indexable: false, siteUrl: SITE })),
      /robots\.txt does not name the sitemap/,
    ],
    [
      "FLOW_PUBLIC=1 with a robots.txt that keeps every crawler out",
      () => setText(open, "robots.txt", `User-agent: *\nDisallow: /\n\nSitemap: ${SITE}/sitemap.xml\n`),
      /FLOW_PUBLIC=1 but robots\.txt disallows every crawler/,
    ],
    ["FLOW_PUBLIC=1 without a sitemap", () => setText(open, "sitemap.xml", null), /no sitemap\.xml/],
    [
      "FLOW_PUBLIC=1 with a sitemap missing an episode",
      () =>
        setText(open, "sitemap.xml", sitemapXml(SITE, ["/", "/series/s", "/watch/s/episode-1"])),
      /misses 1 page/,
    ],
    [
      // The old rule listed the feed and the episodes only, so a page about a
      // series would have been built and left out of every search result.
      "FLOW_PUBLIC=1 with a sitemap missing the series page",
      () =>
        setText(
          open,
          "sitemap.xml",
          sitemapXml(SITE, ["/", "/watch/s/episode-1", "/watch/s/episode-2"]),
        ),
      /misses 1 page\(s\): https:\/\/[^\s]+\/series\/s/,
    ],
    [
      "FLOW_PUBLIC=1 with a sitemap on another host",
      () =>
        setText(
          open,
          "sitemap.xml",
          sitemapXml("https://abc.pages.dev", [
            "/",
            "/series/s",
            "/watch/s/episode-1",
            "/watch/s/episode-2",
          ]),
        ),
      /lists what is not a page/,
    ],
    [
      "FLOW_PUBLIC=1 with a page still saying noindex",
      () => mapPage(open, "watch/s/episode-1.html", (html) => html.replace("<title>", '<meta name="robots" content="noindex"/><title>')),
      /FLOW_PUBLIC=1 but watch\/s\/episode-1\.html says noindex/,
    ],
    [
      "FLOW_PUBLIC=1 with the offline page indexable",
      () => mapPage(open, "offline.html", (html) => html.replace('<meta name="robots" content="noindex, nofollow"/>', "")),
      /offline\.html has no meta robots noindex/,
    ],
  ];

  it.each(publicSabotage)("refuses an export with %s", (_label, make, expected) => {
    expect(problemsOf(make()).join("\n")).toMatch(expected);
  });

  it("holds Cloudflare Pages' own limits", () => {
    expect(pagesLimitProblems(new Map([["a", 10]]))).toEqual([]);
    expect(pagesLimitProblems(new Map([["big.mp4", 26 * 1024 * 1024]])).join()).toMatch(/25 MiB/);
    const many = new Map(Array.from({ length: 20_001 }, (_, i) => [`f${i}`, 1] as [string, number]));
    expect(pagesLimitProblems(many).join()).toMatch(/20000 per deploy/);
  });
});
