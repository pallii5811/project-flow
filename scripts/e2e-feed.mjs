/* global window, document, performance, HTMLVideoElement, KeyboardEvent */
/**
 * Real-browser check of the consumer path on the static export
 * (docs/standard.md §4, "a real browser run of open → play → swipe").
 *
 *   npm run export:web        # or npm run build:web
 *   npm run e2e:web
 *
 * Drives the system Chrome (it decodes H.264; no browser download) headless
 * with a phone profile against apps/web/out, served the way Cloudflare Pages
 * serves it. Prints what it measured and exits 1 on any broken promise:
 *   1. the first episode starts by itself;
 *   2. only current + next are fetched, and the next only its first seconds;
 *   3. a swipe starts the next episode;
 *   4. a shared link starts the exact episode;
 *   5. an unknown episode is a real 404 with the friendly page;
 *   6. no console errors on the way.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const PORT = 3217;
const BASE = `http://localhost:${PORT}`;
/** Must match NEXT_EPISODE_WARM_SECONDS in apps/web/src/features/player/hlsSupport.ts. */
const NEXT_EPISODE_WARM_SECONDS = 4;
const SEGMENT_SECONDS = 2;
/** Generous for a local headless run; production is judged on the p75 target. */
const SWIPE_BUDGET_MS = 1_000;

const failures = [];
const measured = {};

function check(condition, message) {
  if (!condition) failures.push(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  throw new Error(`static server did not start on ${BASE}`);
}

/** Every "playing" event, with the episode it belongs to and when it happened. */
function installPlayingProbe() {
  window.__flowPlaying = [];
  document.addEventListener(
    "playing",
    (event) => {
      const video = event.target;
      const slide =
        video instanceof HTMLVideoElement ? video.closest("[data-content-id]") : null;
      window.__flowPlaying.push({
        contentId: slide ? slide.getAttribute("data-content-id") : null,
        at: performance.now(),
      });
    },
    true,
  );
}

function trackPage(page, label, consoleErrors, mediaRequests) {
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${label}: ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`${label}: ${error.message}`));
  page.on("requestfinished", async (request) => {
    const { pathname } = new URL(request.url());
    const match = /hls\/episode-(\d+)\/(v\d+)?\/?(?:seg_(\d+)\.m4s)?/.exec(pathname);
    if (!match) return;
    const sizes = await request.sizes().catch(() => null);
    mediaRequests.push({
      episode: Number(match[1]),
      rung: match[2] ?? null,
      segment: match[3] === undefined ? null : Number(match[3]),
      bytes: sizes ? sizes.responseBodySize : null,
    });
  });
}

const server = spawn(
  process.execPath,
  ["scripts/serve-static.mjs", "apps/web/out", String(PORT)],
  { cwd: repoRoot, stdio: "ignore" },
);

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  });
  await context.addInitScript(installPlayingProbe);
  const consoleErrors = [];

  // 1–3: cold open, preload budget, swipe.
  const feedMedia = [];
  const feed = await context.newPage();
  trackPage(feed, "feed", consoleErrors, feedMedia);
  await feed.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await feed.waitForFunction(() => window.__flowPlaying.length > 0, null, {
    timeout: 10_000,
  });
  const first = await feed.evaluate(() => window.__flowPlaying[0]);
  measured.firstEpisode = first.contentId;
  measured.navigationToFirstPlayingMs = Math.round(first.at);
  check(
    first.contentId === "item_signal_1",
    `first playing episode is ${first.contentId}`,
  );

  await sleep(2_500);
  const byEpisode = {};
  for (const request of feedMedia) {
    const entry = (byEpisode[request.episode] ??= { segments: [], bytes: 0 });
    if (request.segment !== null)
      entry.segments.push(`${request.rung}/${request.segment}`);
    entry.bytes += request.bytes ?? 0;
  }
  measured.mediaAtOpen = byEpisode;
  const fetchedEpisodes = Object.keys(byEpisode).map(Number);
  check(
    fetchedEpisodes.every((episode) => episode === 1 || episode === 2),
    `media fetched beyond current + next: episodes ${fetchedEpisodes.join(", ")}`,
  );
  const warmSegments = Math.ceil(NEXT_EPISODE_WARM_SECONDS / SEGMENT_SECONDS);
  const nextTooFar = feedMedia.filter(
    (request) =>
      request.episode === 2 &&
      request.segment !== null &&
      request.segment >= warmSegments,
  );
  check(
    nextTooFar.length === 0,
    `next episode fetched past its first ${NEXT_EPISODE_WARM_SECONDS} s: ${nextTooFar
      .map((request) => `${request.rung}/seg_${request.segment}`)
      .join(", ")}`,
  );

  const swipeMs = await feed.evaluate(
    () =>
      new Promise((resolve) => {
        const seen = window.__flowPlaying.length;
        const start = performance.now();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        const poll = () => {
          const hit = window.__flowPlaying
            .slice(seen)
            .find((entry) => entry.contentId === "item_signal_2");
          if (hit) resolve(Math.round(hit.at - start));
          else if (performance.now() - start > 5_000) resolve(null);
          else window.requestAnimationFrame(poll);
        };
        poll();
      }),
  );
  measured.swipeToNextPlayingMs = swipeMs;
  check(swipeMs !== null, "swipe did not start the next episode within 5 s");
  check(
    swipeMs === null || swipeMs <= SWIPE_BUDGET_MS,
    `swipe took ${swipeMs} ms (budget ${SWIPE_BUDGET_MS} ms)`,
  );
  await feed.close();

  // 4: shared link.
  const shared = await context.newPage();
  trackPage(shared, "shared", consoleErrors, []);
  await shared.goto(`${BASE}/watch/signal-night/episode-3?utm_source=share`, {
    waitUntil: "domcontentloaded",
  });
  await shared.waitForFunction(() => window.__flowPlaying.length > 0, null, {
    timeout: 10_000,
  });
  const sharedFirst = await shared.evaluate(() => window.__flowPlaying[0]);
  measured.sharedLinkFirstEpisode = sharedFirst.contentId;
  check(
    sharedFirst.contentId === "item_signal_3",
    `shared link started ${sharedFirst.contentId}`,
  );
  await shared.close();

  // 5: unknown episode.
  const missing = await context.newPage();
  const response = await missing.goto(`${BASE}/watch/signal-night/does-not-exist`);
  measured.unknownEpisodeStatus = response ? response.status() : null;
  check(response?.status() === 404, `unknown episode answered ${response?.status()}`);
  check(
    (await missing.textContent("body"))?.includes("This episode is unavailable.") ===
      true,
    "unknown episode page lacks the friendly text",
  );
  await missing.close();

  // 6: console.
  measured.consoleErrors = consoleErrors;
  check(consoleErrors.length === 0, `console errors: ${consoleErrors.join(" | ")}`);
} catch (error) {
  failures.push(`run aborted: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser?.close();
  server.kill();
}

console.error(JSON.stringify(measured, null, 2));
if (failures.length > 0) {
  console.error("e2e-feed: FAILED");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.error("e2e-feed: ok");
