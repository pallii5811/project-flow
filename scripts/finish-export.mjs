/**
 * The last step of every web build: what Cloudflare Pages serves around the
 * pages.
 *
 *   node scripts/finish-export.mjs apps/web/out
 *
 * Writes into the export:
 *   _headers             caching, security headers, noindex while the beta is closed
 *   robots.txt           closed: search engines out; public: everything in, with the sitemap
 *   sitemap.xml          only when FLOW_PUBLIC=1
 *   offline-shell.html   the offline page without the app's scripts, for the service worker
 *   sw.js                the service worker of this build (or one that retires it)
 * and puts into every page a meta policy that lists the hash of each inline
 * script it carries (scripts/lib/platform.mjs, withScriptPolicy).
 *
 * Reads: FLOW_PUBLIC, NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_ANALYTICS_ENDPOINT,
 * MEDIA_BASE_URL, FLOW_SERVICE_WORKER. It refuses to write a worker whose
 * offline shell names a file the export does not have: the browser would
 * refuse to install it, silently.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RETIRING_SERVICE_WORKER,
  buildVersion,
  cssAssetsOf,
  headersFile,
  isPublicLaunch,
  offlineShell,
  robotsTxt,
  serviceWorkerSource,
  sitemapXml,
  staticAssetsOf,
  withScriptPolicy,
} from "./lib/platform.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const exportDir = resolve(process.argv[2] ?? "apps/web/out");
/** Same fallback as apps/web/src/lib/siteUrl.ts: a local build points at localhost. */
const LOCAL_SITE_URL = "http://localhost:3000";

function die(message) {
  console.error(`finish-export: ${message}`);
  process.exit(1);
}

function filesUnder(dir, keep) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, keep);
    return keep(name) ? [path] : [];
  });
}

if (!existsSync(join(exportDir, "index.html"))) die(`no export at ${exportDir}`);

const indexable = isPublicLaunch(process.env.FLOW_PUBLIC);
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || LOCAL_SITE_URL).replace(/\/$/, "");
const serviceWorkerOn = process.env.FLOW_SERVICE_WORKER !== "off";

// 1. The offline shell, before the pages get their policies (it gets its own).
const offlinePage = join(exportDir, "offline.html");
if (!existsSync(offlinePage)) die("the export has no offline.html (apps/web/src/app/offline)");
writeFileSync(join(exportDir, "offline-shell.html"), offlineShell(readFileSync(offlinePage, "utf8")));

// 2. Every page lists its own inline scripts.
const pages = filesUnder(exportDir, (name) => name.endsWith(".html"));
for (const page of pages) {
  writeFileSync(page, withScriptPolicy(readFileSync(page, "utf8")));
}
const shellHtml = readFileSync(join(exportDir, "offline-shell.html"), "utf8");

// 3. The service worker and the files of its offline shell.
// "/offline-shell", not ".html": Pages redirects the latter (service-worker.js).
const precache = new Set(["/offline-shell", ...staticAssetsOf(shellHtml)]);
for (const path of [...precache]) {
  if (!path.endsWith(".css")) continue;
  const file = join(exportDir, path.slice(1));
  if (!existsSync(file)) continue;
  for (const asset of cssAssetsOf(path, readFileSync(file, "utf8"))) precache.add(asset);
}
const missing = [...precache].filter(
  (path) =>
    !existsSync(join(exportDir, path.slice(1))) &&
    !existsSync(join(exportDir, `${path.slice(1)}.html`)),
);
if (missing.length > 0) {
  die(`the offline shell names files the export does not have: ${missing.join(", ")}`);
}
const buildIds = readdirSync(join(exportDir, "_next/static")).filter(
  (name) => !["chunks", "css", "media"].includes(name),
);
const version = buildVersion([...buildIds, ...[...precache].sort()]);
const template = readFileSync(join(repoRoot, "scripts/lib/service-worker.js"), "utf8");
writeFileSync(
  join(exportDir, "sw.js"),
  serviceWorkerOn
    ? serviceWorkerSource(template, { version, precache: [...precache].sort() })
    : RETIRING_SERVICE_WORKER,
);

// 4. Headers, robots and the sitemap follow the launch switch.
writeFileSync(
  join(exportDir, "_headers"),
  headersFile({
    indexable,
    analyticsEndpoint: process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT,
    mediaBaseUrl: process.env.MEDIA_BASE_URL,
  }),
);
writeFileSync(join(exportDir, "robots.txt"), robotsTxt({ indexable, siteUrl }));
const sitemap = join(exportDir, "sitemap.xml");
const watchPaths = pages
  .map((page) => relative(exportDir, page).split("\\").join("/"))
  .filter((name) => name.startsWith("watch/"))
  .map((name) => `/${name.replace(/\.html$/, "")}`)
  .sort();
if (indexable) writeFileSync(sitemap, sitemapXml(siteUrl, ["/", ...watchPaths]));
else rmSync(sitemap, { force: true });

console.error(
  `finish-export: ${pages.length} pages with their script policy; ` +
    `service worker ${serviceWorkerOn ? `${version}, ${precache.size} files in the offline shell` : "RETIRING"}; ` +
    (indexable
      ? `PUBLIC: indexable, sitemap of ${watchPaths.length + 1} pages`
      : "closed beta: noindex, robots.txt keeps search engines out"),
);
