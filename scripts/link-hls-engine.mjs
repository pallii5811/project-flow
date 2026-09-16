/**
 * Writes the hls.js chunk URL into the exported pages (speed-4).
 *
 *   node scripts/link-hls-engine.mjs apps/web/out
 *
 * The warmup script in every feed page (apps/web/src/features/player/
 * hlsSupport.ts, buildHlsWarmupScript) preloads the hls.js chunk before the
 * page's JavaScript runs, but the chunk name is a hash known only after
 * `next build`. This finds the one chunk that is hls.js and replaces the
 * placeholder in the HTML and RSC files. It fails when it cannot find exactly
 * one chunk, or when no page carried the placeholder: a silent miss would
 * quietly bring back the late download.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const PLACEHOLDER = "__FLOW_HLS_ENGINE_CHUNK__";
/** An event name only hls.js contains. */
const HLS_SIGNATURE = "hlsManifestParsed";

const exportDir = resolve(process.argv[2] ?? "apps/web/out");
const chunksDir = join(exportDir, "_next/static/chunks");

function filesUnder(dir, keep) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, keep);
    return keep(name) ? [path] : [];
  });
}

let engines;
try {
  engines = filesUnder(chunksDir, (name) => name.endsWith(".js")).filter((path) =>
    readFileSync(path, "utf8").includes(HLS_SIGNATURE),
  );
} catch {
  console.error(`link-hls-engine: no chunks at ${chunksDir}`);
  process.exit(1);
}
if (engines.length !== 1) {
  console.error(
    `link-hls-engine: expected exactly one hls.js chunk, found ${engines.length}: ${engines
      .map((path) => relative(exportDir, path))
      .join(", ")}`,
  );
  process.exit(1);
}
const engineUrl = `/${relative(exportDir, engines[0]).split("\\").join("/")}`;

let linked = 0;
for (const path of filesUnder(exportDir, (name) => /\.(html|txt)$/.test(name))) {
  const text = readFileSync(path, "utf8");
  if (!text.includes(PLACEHOLDER)) continue;
  writeFileSync(path, text.split(PLACEHOLDER).join(engineUrl));
  linked += 1;
}
if (linked === 0) {
  console.error("link-hls-engine: no exported page carries the warmup placeholder");
  process.exit(1);
}
console.error(`link-hls-engine: ${engineUrl} linked in ${linked} files`);
