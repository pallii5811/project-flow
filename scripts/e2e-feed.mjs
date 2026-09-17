/* global window, document, performance, DOMException, HTMLMediaElement, HTMLVideoElement, KeyboardEvent */
/**
 * Real-browser check of the consumer path on the static export
 * (docs/standard.md §4, "a real browser run of open → play → swipe").
 *
 *   npm run build:web        && npm run e2e:web          # normal catalog
 *   npm run build:web:stress && npm run e2e:web:scale    # 600 extra episodes
 *
 * Flags: --scale serves apps/web/out-stress and adds the catalog-scale checks;
 * --throttle also measures cold opens on a throttled phone (report only).
 *
 * Drives the system Chrome (it decodes H.264; no browser download) headless
 * with a phone profile against the export, served the way Cloudflare Pages
 * serves it. Prints what it measured and exits 1 on any broken promise:
 *   1. the first episode starts by itself, within the first-play budget;
 *   2. only current + next are fetched, and the next only its first seconds;
 *   3. at open, few posters are fetched and few slides render media;
 *   4. a swipe starts the next episode;
 *   5. a shared link starts the exact episode;
 *   6. an unknown episode is a real 404 with the friendly page;
 *   7. the HTML of the home and of an episode page stays small;
 *   8. no console errors on the way.
 * With --scale also: a deep link far into the catalog plays, and swiping
 * through the feed extends it without ever holding the whole catalog.
 *
 * Playback recovery (docs/decisions.md, "Playback never ends on a poster"):
 *   9. Continue on the resume offer really seeks to the saved position;
 *  10. a viewer who once unmuted still gets autoplay (muted) on return;
 *  11. a returning viewer who finished an episode lands on the next one;
 *  12. going offline while the next episode warms, then back online, still
 *      plays it (or shows the error and skips);
 *  13. an episode that cannot load shows the error, then skips on its own.
 */
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const SCALE = process.argv.includes("--scale");
const THROTTLE = process.argv.includes("--throttle");
/** --export=<dir> serves another export, e.g. one built from master in a worktree. */
const EXPORT_ARG = process.argv.find((arg) => arg.startsWith("--export="));
const EXPORT_DIR = EXPORT_ARG
  ? resolve(EXPORT_ARG.slice("--export=".length))
  : SCALE
    ? "apps/web/out-stress"
    : "apps/web/out";
const PORT = 3217;
const BASE = `http://localhost:${PORT}`;
/** Must match NEXT_EPISODE_WARM_SECONDS in apps/web/src/features/player/hlsSupport.ts. */
const NEXT_EPISODE_WARM_SECONDS = 4;
const SEGMENT_SECONDS = 2;
/** Generous for a local headless run; production is judged on the p75 target. */
const SWIPE_BUDGET_MS = 1_000;
/** docs/standard.md §3: first play < 1.5 s. Localhost has no latency, so this bounds the code. */
const FIRST_PLAY_BUDGET_MS = 1_500;
/** Posters at open: the playing episode, its neighbours, and nothing from the catalog. */
const OPEN_POSTER_BUDGET = 6;
/** Slides with poster or player: index-2 .. index+2. */
const MEDIA_SLIDE_BUDGET = 5;
/** Server HTML carries only the first-frame slides, whatever the catalog size. */
const HTML_BUDGET_BYTES = 50_000;
/** Feed page (about 40) plus extensions; never the whole catalog. */
const FEED_LIST_BUDGET = 120;

const failures = [];
const measured = { mode: SCALE ? "scale" : "normal" };

function check(condition, message) {
  if (!condition) failures.push(message);
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

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

function trackPage(page, label, consoleErrors, mediaRequests, posterRequests = []) {
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${label}: ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`${label}: ${error.message}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/posters/")) posterRequests.push(url.pathname + url.search);
  });
  page.on("requestfinished", async (request) => {
    const { pathname } = new URL(request.url());
    const match =
      /hls\/episode-(\d+)\/(?:(v\d+)\/)?(?:seg_(\d+)\.m4s|(master)\.m3u8|index\.m3u8|init_\d+\.mp4)/.exec(
        pathname,
      );
    if (!match) return;
    const sizes = await request.sizes().catch(() => null);
    mediaRequests.push({
      episode: Number(match[1]),
      rung: match[2] ?? null,
      segment: match[3] === undefined ? null : Number(match[3]),
      master: match[4] === "master",
      bytes: sizes ? sizes.responseBodySize : null,
    });
  });
}

/** Slides in the feed list, and how many of them render a poster or a player. */
function feedShape() {
  const feed = document.querySelector('[role="feed"]');
  const slides = feed ? [...feed.children] : [];
  return {
    listed: slides.length,
    withMedia: slides.filter((slide) => slide.querySelector("img, video")).length,
    active: document
      .querySelector('[data-active="true"]')
      ?.getAttribute("data-content-id") ?? null,
  };
}

function swipeAndWaitForPlaying(expectedId) {
  return new Promise((resolveSwipe) => {
    const seen = window.__flowPlaying.length;
    const start = performance.now();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    const poll = () => {
      const hit = window.__flowPlaying
        .slice(seen)
        .find((entry) => (expectedId ? entry.contentId === expectedId : true));
      if (hit) resolveSwipe({ ms: Math.round(hit.at - start), contentId: hit.contentId });
      else if (performance.now() - start > 5_000) resolveSwipe(null);
      else window.requestAnimationFrame(poll);
    };
    poll();
  });
}

/**
 * The phone browsers' autoplay rule: sound needs a gesture first. A play()
 * with sound before any user activation is refused with NotAllowedError, and
 * unmuting a playing video without one pauses it (Chrome does both).
 */
function installPhoneAutoplayRule() {
  // Not navigator.userActivation: Playwright's evaluate() counts as a gesture.
  let gesture = false;
  for (const type of ["pointerdown", "touchstart", "keydown", "click"]) {
    window.addEventListener(
      type,
      (event) => {
        if (event.isTrusted) gesture = true;
      },
      true,
    );
  }
  const mutedProperty = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "muted");
  Object.defineProperty(HTMLMediaElement.prototype, "muted", {
    configurable: true,
    enumerable: mutedProperty.enumerable,
    get() {
      return mutedProperty.get.call(this);
    },
    set(value) {
      mutedProperty.set.call(this, value);
      if (!value && !this.paused && !gesture) this.pause();
    },
  });
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function playWithPhoneRule() {
    if (!this.muted && !gesture) {
      return Promise.reject(
        new DOMException("play() with sound needs a user gesture", "NotAllowedError"),
      );
    }
    return play.call(this);
  };
}

/** Seconds into the episode on the active slide, or null without a player. */
function activeVideoTime() {
  const video = document.querySelector('[data-active="true"] video');
  return video ? Math.round(video.currentTime * 100) / 100 : null;
}

/** A fresh phone profile, optionally with a saved resume point (the v1 format). */
async function phoneContext(browser, snapshot) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(installPlayingProbe);
  if (snapshot) {
    await context.addInitScript((saved) => {
      window.localStorage.setItem("project-flow.resume.v1", JSON.stringify(saved));
    }, snapshot);
  }
  return context;
}

function fileBytes(relativePath) {
  try {
    return statSync(resolve(repoRoot, EXPORT_DIR, relativePath)).size;
  } catch {
    return null;
  }
}

/** Cold opens on a throttled mid-range phone: report only, never a failure. */
async function measureThrottled(browser, runs = 3) {
  const results = [];
  for (let run = 0; run < runs; run += 1) {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    });
    await context.addInitScript(installPlayingProbe);
    const page = await context.newPage();
    let hlsChunkUrl = null;
    page.on("response", async (response) => {
      const url = response.url();
      if (!url.endsWith(".js") || hlsChunkUrl) return;
      const body = await response.text().catch(() => "");
      if (body.includes("hlsManifestParsed")) hlsChunkUrl = url;
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
      timeout: 60_000,
    });
    const timing = await page.evaluate((chunkUrl) => {
      const entries = performance.getEntriesByType("resource");
      const startOf = (predicate) => {
        const entry = entries.find((candidate) => predicate(candidate.name));
        return entry ? Math.round(entry.startTime) : null;
      };
      return {
        firstPlayingMs: Math.round(window.__flowPlaying[0].at),
        hlsEngineRequestedMs: chunkUrl ? startOf((name) => name === chunkUrl) : null,
        masterPlaylistRequestedMs: startOf((name) => name.includes("master.m3u8")),
        firstSegmentRequestedMs: startOf((name) => name.endsWith(".m4s")),
      };
    }, hlsChunkUrl);
    results.push(timing);
    await context.close();
  }
  const sorted = results.map((entry) => entry.firstPlayingMs).sort((a, b) => a - b);
  return { runs: results, medianFirstPlayingMs: sorted[Math.floor(sorted.length / 2)] };
}

const server = spawn(process.execPath, ["scripts/serve-static.mjs", EXPORT_DIR, String(PORT)], {
  cwd: repoRoot,
  stdio: "ignore",
});

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

  // 1–4: cold open, preload budget, open budget, swipe.
  const feedMedia = [];
  const feedPosters = [];
  const feed = await context.newPage();
  trackPage(feed, "feed", consoleErrors, feedMedia, feedPosters);
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
  check(
    first.at <= FIRST_PLAY_BUDGET_MS,
    `first play took ${Math.round(first.at)} ms (budget ${FIRST_PLAY_BUDGET_MS} ms)`,
  );

  await sleep(2_500);
  const byEpisode = {};
  for (const request of feedMedia) {
    const entry = (byEpisode[request.episode] ??= {
      segments: [],
      masterRequests: 0,
      bytes: 0,
    });
    if (request.segment !== null)
      entry.segments.push(`${request.rung}/${request.segment}`);
    if (request.master) entry.masterRequests += 1;
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
  check(
    (byEpisode[1]?.masterRequests ?? 0) <= 1,
    `first episode playlist fetched ${byEpisode[1]?.masterRequests} times`,
  );

  const postersAtOpen = [...new Set(feedPosters)];
  measured.postersRequestedAtOpen = postersAtOpen.length;
  check(
    postersAtOpen.length <= OPEN_POSTER_BUDGET,
    `${postersAtOpen.length} posters requested at open (budget ${OPEN_POSTER_BUDGET})`,
  );
  const shapeAtOpen = await feed.evaluate(feedShape);
  measured.feedAtOpen = shapeAtOpen;
  check(
    shapeAtOpen.withMedia <= MEDIA_SLIDE_BUDGET,
    `${shapeAtOpen.withMedia} slides render media at open (budget ${MEDIA_SLIDE_BUDGET})`,
  );
  check(
    shapeAtOpen.listed <= FEED_LIST_BUDGET,
    `feed lists ${shapeAtOpen.listed} slides at open (budget ${FEED_LIST_BUDGET})`,
  );

  // Progress lives outside React state now: the bar must still move.
  measured.progressBarAtOpen = await feed.evaluate(() =>
    Number(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")),
  );
  check(
    measured.progressBarAtOpen > 0,
    `progress bar did not move while playing (${measured.progressBarAtOpen})`,
  );

  const swipe = await feed.evaluate(swipeAndWaitForPlaying, "item_signal_2");
  measured.swipeToNextPlayingMs = swipe ? swipe.ms : null;
  check(swipe !== null, "swipe did not start the next episode within 5 s");
  check(
    swipe === null || swipe.ms <= SWIPE_BUDGET_MS,
    `swipe took ${swipe?.ms} ms (budget ${SWIPE_BUDGET_MS} ms)`,
  );

  // A scroll gesture (not a key) still moves to the next episode once it
  // settles: the index is committed at scrollend, not mid-gesture (PB-6).
  if (!SCALE) {
    await feed.mouse.move(187, 400);
    await feed.mouse.wheel(0, 812);
    const scrolled = await feed
      .waitForFunction(
        () =>
          document.querySelector('[data-active="true"]')?.getAttribute("data-content-id") ===
          "item_signal_3",
        null,
        { timeout: 5_000 },
      )
      .then(() => true)
      .catch(() => false);
    measured.scrollGestureMovedTo = await feed.evaluate(
      () => document.querySelector('[data-active="true"]')?.getAttribute("data-content-id") ?? null,
    );
    check(scrolled, `a scroll gesture did not move to item_signal_3 (on ${measured.scrollGestureMovedTo})`);
  }

  // Swipe deep into the feed: the list must extend, media stays bounded.
  if (SCALE) {
    for (let step = 0; step < 45; step += 1) {
      await feed.evaluate(() =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" })),
      );
      await sleep(60);
    }
    await sleep(500);
    const deepSwipe = await feed.evaluate(swipeAndWaitForPlaying, null);
    const deepShape = await feed.evaluate(feedShape);
    measured.afterDeepSwipes = {
      ...deepShape,
      swipeToPlayingMs: deepSwipe ? deepSwipe.ms : null,
    };
    check(
      deepShape.listed > 47,
      `feed did not extend: ${deepShape.listed} slides after 47 swipes`,
    );
    check(
      deepShape.listed <= FEED_LIST_BUDGET,
      `feed lists ${deepShape.listed} slides after swipes (budget ${FEED_LIST_BUDGET})`,
    );
    check(
      deepShape.withMedia <= MEDIA_SLIDE_BUDGET,
      `${deepShape.withMedia} slides render media after swipes (budget ${MEDIA_SLIDE_BUDGET})`,
    );
    check(
      deepSwipe !== null && deepSwipe.ms <= SWIPE_BUDGET_MS,
      `swipe deep in the feed took ${deepSwipe?.ms ?? "more than 5000"} ms (budget ${SWIPE_BUDGET_MS} ms)`,
    );
  }
  await feed.close();

  // 5: shared links.
  const sharedTargets = [["/watch/signal-night/episode-3", "item_signal_3"]];
  if (SCALE) sharedTargets.push(["/watch/stress-10/episode-60", "item_stress_10_60"]);
  measured.sharedLinks = {};
  for (const [path, expected] of sharedTargets) {
    const shared = await context.newPage();
    trackPage(shared, `shared ${path}`, consoleErrors, []);
    await shared.goto(`${BASE}${path}?utm_source=share`, {
      waitUntil: "domcontentloaded",
    });
    await shared.waitForFunction(() => window.__flowPlaying.length > 0, null, {
      timeout: 10_000,
    });
    const sharedFirst = await shared.evaluate(() => window.__flowPlaying[0]);
    measured.sharedLinks[path] = {
      firstEpisode: sharedFirst.contentId,
      firstPlayingMs: Math.round(sharedFirst.at),
    };
    check(
      sharedFirst.contentId === expected,
      `shared link ${path} started ${sharedFirst.contentId}`,
    );
    await shared.close();
  }

  // Auto-continue within the series, from a shared link.
  const [continueFrom, continueTo] = SCALE
    ? ["/watch/stress-2/episode-59", "item_stress_2_60"]
    : ["/watch/signal-night/episode-4", "item_signal_5"];
  const continuing = await context.newPage();
  trackPage(continuing, "continue", consoleErrors, []);
  await continuing.goto(`${BASE}${continueFrom}`, { waitUntil: "domcontentloaded" });
  const continued = await continuing
    .waitForFunction(
      (id) => window.__flowPlaying.some((entry) => entry.contentId === id),
      continueTo,
      { timeout: 25_000 },
    )
    .then(() => true)
    .catch(() => false);
  measured.autoContinue = { from: continueFrom, to: continueTo, continued };
  check(continued, `episode at ${continueFrom} did not continue to ${continueTo}`);
  await continuing.close();

  // Resume: an episode outside the first frame still reopens where it was.
  const resumeTarget = SCALE
    ? { contentId: "item_stress_3_10", seriesId: "series_stress_3", episodeId: "ep_stress_3_10" }
    : { contentId: "item_signal_4", seriesId: "series_signal", episodeId: "ep_signal_4" };
  const resumeContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  await resumeContext.addInitScript(installPlayingProbe);
  await resumeContext.addInitScript((snapshot) => {
    window.localStorage.setItem("project-flow.resume.v1", JSON.stringify(snapshot));
  }, {
    ...resumeTarget,
    positionMs: 5_000,
    durationMs: 10_000,
    muted: true,
    captionsOn: false,
    updatedAt: Date.now(),
    completed: false,
  });
  const resumed = await resumeContext.newPage();
  trackPage(resumed, "resume", consoleErrors, []);
  await resumed.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const resumedOk = await resumed
    .waitForFunction(
      (id) =>
        window.__flowPlaying.some((entry) => entry.contentId === id) &&
        document.querySelector('[aria-label="Continue story"]') !== null,
      resumeTarget.contentId,
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);
  measured.resume = { target: resumeTarget.contentId, playingWithOffer: resumedOk };
  check(resumedOk, `resume did not reopen ${resumeTarget.contentId} with its offer`);

  // 9: Continue seeks to the saved position (5 s), right away.
  if (resumedOk) {
    const beforeContinue = await resumed.evaluate(activeVideoTime);
    await resumed.click('[aria-label="Continue episode"]');
    await sleep(800);
    const afterContinue = await resumed.evaluate(activeVideoTime);
    measured.resume.continueSeek = { beforeSeconds: beforeContinue, afterSeconds: afterContinue };
    check(
      afterContinue !== null && afterContinue >= 4.5,
      `Continue did not seek to the saved 5 s: the episode was at ${beforeContinue} s, then ${afterContinue} s`,
    );
  }
  await resumeContext.close();

  // 10: a viewer who once turned the sound on still gets autoplay, muted.
  // Headless Chrome plays sound without a gesture whatever --autoplay-policy
  // says (measured 2026-09-17), phones do not: this page gets the phone rule.
  {
    const mutedContext = await phoneContext(browser, {
      contentId: "item_signal_1",
      seriesId: "series_signal",
      episodeId: "ep_signal_1",
      positionMs: 500,
      durationMs: 10_000,
      muted: false,
      captionsOn: false,
      updatedAt: Date.now(),
      completed: false,
    });
    await mutedContext.addInitScript(installPhoneAutoplayRule);
    const page = await mutedContext.newPage();
    trackPage(page, "unmuted preference", consoleErrors, []);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const played = await page
      .waitForFunction(() => window.__flowPlaying.length > 0, null, { timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    // Long enough for the saved preference to have been applied.
    await sleep(3_000);
    const state = await page.evaluate(() => {
      const video = document.querySelector('[data-active="true"] video');
      return video
        ? { muted: video.muted, paused: video.paused, seconds: video.currentTime }
        : null;
    });
    measured.unmutedPreference = { played, state };
    check(
      played && state !== null && !state.paused && state.seconds >= 1,
      `a stored unmuted preference left the first episode stopped (${JSON.stringify(state)})`,
    );
    check(state?.muted === true, `autoplay on return is not muted (${JSON.stringify(state)})`);
    await mutedContext.close();
  }

  // 11: a returning viewer who finished an episode lands on the next one.
  {
    const [finished, expectedNext] = SCALE
      ? [
          { contentId: "item_stress_3_10", seriesId: "series_stress_3", episodeId: "ep_stress_3_10" },
          "item_stress_3_11",
        ]
      : [
          { contentId: "item_signal_2", seriesId: "series_signal", episodeId: "ep_signal_2" },
          "item_signal_3",
        ];
    const returnContext = await phoneContext(browser, {
      ...finished,
      positionMs: 10_000,
      durationMs: 10_000,
      muted: true,
      captionsOn: false,
      updatedAt: Date.now(),
      completed: true,
    });
    const page = await returnContext.newPage();
    trackPage(page, "return after finishing", consoleErrors, []);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    // Before the first episode could end: auto-continue must not be what gets there.
    const landed = await page
      .waitForFunction(
        (id) =>
          window.__flowPlaying.some((entry) => entry.contentId === id) &&
          document.querySelector('[aria-label="Continue story"]') !== null,
        expectedNext,
        { timeout: 8_000 },
      )
      .then(() => true)
      .catch(() => false);
    const firstPlayed = await page.evaluate(() => window.__flowPlaying[0]?.contentId ?? null);
    measured.returnAfterFinishing = { finished: finished.contentId, expectedNext, landed, firstPlayed };
    check(
      landed && firstPlayed === expectedNext,
      `after finishing ${finished.contentId} the viewer landed on ${firstPlayed}, not ${expectedNext} with its offer`,
    );
    await returnContext.close();
  }

  if (!SCALE) {
    // 12: offline while the next episode warms up, then back online.
    const offlineContext = await phoneContext(browser, null);
    const page = await offlineContext.newPage();
    // Network failures are the point here: only script errors count.
    page.on("pageerror", (error) => consoleErrors.push(`offline: ${error.message}`));
    const failedWhileOffline = [];
    page.on("requestfailed", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.includes("/hls/")) failedWhileOffline.push(pathname.replace(/^.*\/hls\//, ""));
    });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__flowPlaying.length > 0, null, { timeout: 10_000 });
    // The feed page is built (catalog fetched): episode 3 has a slide to warm in.
    await page.waitForFunction(
      () => (document.querySelector('[role="feed"]')?.children.length ?? 0) >= 4,
      null,
      { timeout: 10_000 },
    );
    await offlineContext.setOffline(true);
    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" })),
    );
    // Episode 3 is now the next one and tries to warm up with no network.
    await sleep(Number(process.env.FLOW_E2E_OFFLINE_MS ?? 12_000));
    await offlineContext.setOffline(false);
    await sleep(1_000);
    const outcome = await page.evaluate(
      () =>
        new Promise((resolveOutcome) => {
          const seen = window.__flowPlaying.length;
          const start = performance.now();
          let errorShown = false;
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
          const poll = () => {
            const active = document.querySelector('[data-active="true"]');
            if (active?.querySelector('[role="status"]')) errorShown = true;
            const played = window.__flowPlaying.slice(seen).map((entry) => entry.contentId);
            if (played.includes("item_signal_3")) {
              resolveOutcome({ result: "played", ms: Math.round(performance.now() - start) });
            } else if (errorShown && played.includes("item_signal_4")) {
              resolveOutcome({ result: "error_then_skip", ms: Math.round(performance.now() - start) });
            } else if (performance.now() - start > 15_000) {
              const video = active?.querySelector("video");
              resolveOutcome({
                result: "stuck",
                active: active?.getAttribute("data-content-id") ?? null,
                seconds: video ? video.currentTime : null,
                paused: video ? video.paused : null,
                errorShown,
              });
            } else {
              window.setTimeout(poll, 100);
            }
          };
          poll();
        }),
    );
    measured.offlineWhileWarming = { ...outcome, failedMediaRequests: failedWhileOffline };
    check(
      outcome.result === "played" || outcome.result === "error_then_skip",
      `after going offline while episode 3 warmed and coming back, it never played: ${JSON.stringify(outcome)}`,
    );
    await offlineContext.close();

    // 13: an episode whose media cannot load shows the error, then skips by itself.
    const brokenContext = await phoneContext(browser, null);
    const broken = await brokenContext.newPage();
    broken.on("pageerror", (error) => consoleErrors.push(`broken episode: ${error.message}`));
    await broken.route("**/hls/episode-3/**", (route) =>
      route.fulfill({ status: 404, body: "not found" }),
    );
    await broken.goto(`${BASE}/watch/signal-night/episode-3`, { waitUntil: "domcontentloaded" });
    const failure = await broken.evaluate(
      () =>
        new Promise((resolveFailure) => {
          const start = performance.now();
          let shownAt = null;
          const poll = () => {
            const active = document.querySelector('[data-active="true"]');
            const status = active?.querySelector('[role="status"]');
            if (status && shownAt === null) shownAt = performance.now();
            const skipped = window.__flowPlaying.find((entry) => entry.contentId === "item_signal_4");
            if (skipped) {
              resolveFailure({
                errorShownMs: shownAt === null ? null : Math.round(shownAt - start),
                errorVisibleForMs: shownAt === null ? null : Math.round(skipped.at - shownAt),
                skippedTo: skipped.contentId,
              });
            } else if (performance.now() - start > 20_000) {
              resolveFailure({
                errorShownMs: shownAt === null ? null : Math.round(shownAt - start),
                skippedTo: null,
                active: active?.getAttribute("data-content-id") ?? null,
              });
            } else {
              window.setTimeout(poll, 50);
            }
          };
          poll();
        }),
    );
    measured.unplayableEpisode = failure;
    check(
      failure.errorShownMs !== null && failure.skippedTo === "item_signal_4",
      `an episode that cannot load did not show its error and skip: ${JSON.stringify(failure)}`,
    );
    check(
      failure.errorVisibleForMs === undefined ||
        failure.errorVisibleForMs === null ||
        failure.errorVisibleForMs >= 1_500,
      `the playback error was visible only ${failure.errorVisibleForMs} ms before the skip`,
    );
    await brokenContext.close();
  }

  // 6: unknown episode.
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

  // 7: HTML weight.
  measured.htmlBytes = {
    "index.html": fileBytes("index.html"),
    "watch/signal-night/episode-3.html": fileBytes("watch/signal-night/episode-3.html"),
  };
  for (const [name, bytes] of Object.entries(measured.htmlBytes)) {
    check(bytes !== null, `${name} is missing from the export`);
    check(
      bytes === null || bytes <= HTML_BUDGET_BYTES,
      `${name} is ${bytes} bytes (budget ${HTML_BUDGET_BYTES})`,
    );
  }

  // 8: console.
  measured.consoleErrors = consoleErrors;
  check(consoleErrors.length === 0, `console errors: ${consoleErrors.join(" | ")}`);

  if (THROTTLE) measured.throttledColdOpen = await measureThrottled(browser);
} catch (error) {
  failures.push(`run aborted: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser?.close();
  server.kill();
}

console.error(JSON.stringify(measured, null, 2));
if (failures.length > 0) {
  console.error(`e2e-feed (${measured.mode}): FAILED`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.error(`e2e-feed (${measured.mode}): ok`);
