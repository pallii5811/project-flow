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
import { readdirSync, readFileSync, statSync } from "node:fs";
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

function checkEnv() {
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

function checkExport() {
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
    if (watchPages.includes(file) && metaContent(html, "og:image").length === 0) {
      failures.push(`${name} has no og:image: shared links would show no picture`);
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
