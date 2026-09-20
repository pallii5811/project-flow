/**
 * Builds the web export with a stress catalog, for scale checks only.
 *
 *   npm run build:web:stress            # 600 extra episodes (default)
 *   npm run build:web:stress -- 3000    # any size
 *   npm run e2e:web:scale
 *
 * The export lands in apps/web/out-stress, never in apps/web/out, so a stress
 * build cannot be published by mistake (scripts/deploy-checks.mjs also refuses
 * FLOW_STRESS_EPISODES). Run `npm run build:web` again before `npm run e2e:web`:
 * both builds share apps/web/.next.
 *
 * The generated episodes' media is addressed on a second origin (the port
 * `npm run e2e:web:scale` serves with a bucket's CORS headers), because that
 * is how media published to R2 reaches a viewer: the scale run then proves in
 * a browser that such a catalog plays, shows its subtitles and breaks no
 * security policy. `--media-base ""` keeps everything on one origin.
 */
import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const webDir = resolve(repoRoot, "apps/web");
const outDir = resolve(webDir, "out");
const stressDir = resolve(webDir, "out-stress");
const episodes = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "600";
const mediaBaseAt = process.argv.indexOf("--media-base");
/** Must match MEDIA_ORIGIN in scripts/e2e-feed.mjs. */
const mediaBase = mediaBaseAt === -1 ? "http://localhost:3219" : (process.argv[mediaBaseAt + 1] ?? "");

if (!/^\d+$/.test(episodes) || Number(episodes) <= 0) {
  console.error(`build-stress: episode count must be a positive whole number, got "${episodes}"`);
  process.exit(1);
}

rmSync(stressDir, { recursive: true, force: true });
const nextBin = resolve(repoRoot, "node_modules/next/dist/bin/next");
const started = Date.now();
const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: webDir,
  stdio: "inherit",
  env: {
    ...process.env,
    FLOW_STRESS_EPISODES: episodes,
    FLOW_STRESS_MEDIA_BASE: mediaBase,
    // The security policy of the export must allow that origin, or nothing
    // generated would play (scripts/finish-export.mjs writes it).
    ...(mediaBase ? { MEDIA_BASE_URL: mediaBase } : {}),
  },
});
if (result.status !== 0) {
  console.error("build-stress: next build failed");
  process.exit(result.status ?? 1);
}
if (!existsSync(outDir)) {
  console.error("build-stress: next build produced no apps/web/out");
  process.exit(1);
}
// Same post-build steps as `npm run build -w @project-flow/web`.
for (const step of ["scripts/link-hls-engine.mjs", "scripts/finish-export.mjs"]) {
  const done = spawnSync(process.execPath, [resolve(repoRoot, step), outDir], {
    stdio: "inherit",
    // finish-export writes the security policy: it must know the media origin.
    env: { ...process.env, ...(mediaBase ? { MEDIA_BASE_URL: mediaBase } : {}) },
  });
  if (done.status !== 0) process.exit(done.status ?? 1);
}
renameSync(outDir, stressDir);
console.error(
  `build-stress: ${episodes} extra episodes built in ${Math.round(
    (Date.now() - started) / 1000,
  )} s → apps/web/out-stress`,
);
