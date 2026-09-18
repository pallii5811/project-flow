/* global window, document, performance, DOMException, HTMLMediaElement, HTMLVideoElement, KeyboardEvent, Navigator, getComputedStyle */
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
 *  13. an episode that cannot load shows the error, then skips on its own;
 *  14. an episode glimpsed for a second is not where a returning viewer lands;
 *  15. leaving an auto-continued episode in its first second reopens on it (Next episode);
 *  16. a playlist that answers 503 four times plays after the player's 1 s and 3 s retries;
 *  17. sound refused without a gesture: the next episode plays muted and says so;
 *  18. a network that is online but carries nothing: two error skips, then the
 *      feed stops on "Connection problem" instead of running through the feed.
 *
 * The first seconds and the thread of the story (docs/decisions.md, batch 3a):
 *  19. muted cold open: captions drawn by the app above the title block, no
 *      native cues, one "Tap for sound" cue that the first tap removes for good;
 *  20. captions turned off by the viewer stay off while muted, after a reload;
 *  21. a copied link says "Link copied" in a status region; closing the share
 *      sheet copies nothing;
 *  22. a link shared at a moment opens at that moment;
 *  23. a pause shows a play glyph, playing again removes it;
 *  24. the end of a series offers share and follow and starts nothing by itself;
 *      with --scale, tapping the next story plays another series from episode 1.
 *
 * Batch 3a review (R3A):
 *  25. on a landscape phone (812x375) the series end is inside the screen and
 *      its next story is reachable (both modes);
 *  26. there, at the cold open, the caption sits below the notice and left of the rail;
 *  27. a notice replaces the "Next episode" label; a label fading a few seconds in
 *      does not bring "Tap for sound";
 *  28. the link shown when copying fails is a reachable field that stays while focused.
 *
 * Accessibility and polish (docs/decisions.md, batch 3b):
 *  29. Space on a focused rail button presses that button, never play/pause;
 *  30. the Tune sheet is a dialog: focus moves in, Tab stays in, the feed takes no
 *      keys, Escape closes it from anywhere and focus returns to Tune; Close works;
 *      a chip says what changed; in a short landscape frame it stays inside the
 *      picture, its chips scroll to the last one and a tap on the backdrop above
 *      it closes it (R3B-01);
 *  31. a rail toggle keeps its name and says its state with aria-pressed;
 *  32. an episode change is announced politely and focus follows it from the rail;
 *  33. a phone in landscape narrower than 768 px gets the uncropped 9:16 frame, and,
 *      with a notch emulated so the insets are not 0, no page scrolls outside the
 *      feed (R3B-02), the chrome clears the notch on the sides too, and a
 *      letterboxed frame does not pay it a second time (R3B-03);
 *  34. over a white frame every rail icon keeps 3:1 against what is behind it;
 *  35. the mute button shrinks under the finger (touch feedback);
 *   6. (extended) any unknown URL answers 404 with the product's page and a story to tap.
 * Checks 11 and 15 expect a "Next episode" label without a button (B2-UPNEXT).
 */
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { inflateSync } from "node:zlib";
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

/**
 * A previous run's server can still hold the port for a moment. Spawning over
 * it binds nothing: the new server exits, the old one answers the first
 * request and then dies with its parent, and the run fails minutes later with
 * a connection refused that says nothing about the cause. Seen twice on
 * 2026-09-18, running e2e:web and e2e:web:scale back to back.
 */
async function waitForPortFree() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fetch(`${BASE}/`);
    } catch {
      return;
    }
    await sleep(100);
  }
  throw new Error(`port ${PORT} is still answering: another server is holding it`);
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `static server exited with ${child.exitCode} instead of serving ${BASE}`,
      );
    }
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
    if (url.pathname.includes("/posters/"))
      posterRequests.push(url.pathname + url.search);
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

/**
 * Analytics envelopes the page logs (the export has no collector, so the
 * console transport prints each one as "[analytics] <name>", envelope).
 */
function collectAnalytics(page) {
  const events = [];
  page.on("console", async (message) => {
    const text = message.text();
    if (!text.startsWith("[analytics] ")) return;
    const name = text.slice("[analytics] ".length).split(" ")[0];
    const envelope = await message
      .args()[1]
      ?.jsonValue()
      .catch(() => null);
    events.push({ name, properties: envelope?.properties ?? null });
  });
  return events;
}

/** The active slide and the message it shows, if any. */
function activeStatus() {
  const active = document.querySelector('[data-active="true"]');
  const video = active?.querySelector("video");
  return {
    active: active?.getAttribute("data-content-id") ?? null,
    status: active?.querySelector('[role="status"]')?.textContent ?? null,
    muted: video ? video.muted : null,
    paused: video ? video.paused : null,
    seconds: video ? Math.round(video.currentTime * 100) / 100 : null,
  };
}

/** Slides in the feed list, and how many of them render a poster or a player. */
function feedShape() {
  const feed = document.querySelector('[role="feed"]');
  const slides = feed ? [...feed.children] : [];
  return {
    listed: slides.length,
    withMedia: slides.filter((slide) => slide.querySelector("img, video")).length,
    active:
      document.querySelector('[data-active="true"]')?.getAttribute("data-content-id") ??
      null,
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
  const mutedProperty = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "muted",
  );
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

/** Decodes a Playwright PNG screenshot to RGBA pixels. */
function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const colorType = body[9];
      if (body[8] !== 8 || body[12] !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error("unsupported PNG");
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      data.push(body);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[x] = (line[x] + add) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      pixels[(y * width + x) * 4] = line[x * channels];
      pixels[(y * width + x) * 4 + 1] = line[x * channels + 1];
      pixels[(y * width + x) * 4 + 2] = line[x * channels + 2];
      pixels[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    previous = line;
  }
  return { width, height, pixels };
}

/** WCAG relative luminance of an sRGB pixel. */
function luminanceAt(pixels, index) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(pixels[index]) +
    0.7152 * channel(pixels[index + 1]) +
    0.0722 * channel(pixels[index + 2])
  );
}

/**
 * Contrast of an icon against what is around it, from a screenshot of its
 * button: the brightest strokes (98th percentile) against the median pixel,
 * which is the shaded frame behind the icon.
 */
function iconContrast(png) {
  const { pixels, width, height } = decodePng(png);
  const values = [];
  for (let i = 0; i < width * height; i += 1) values.push(luminanceAt(pixels, i * 4));
  values.sort((a, b) => a - b);
  const icon = values[Math.floor(values.length * 0.98)];
  const background = values[Math.floor(values.length / 2)];
  return Math.round(((icon + 0.05) / (background + 0.05)) * 100) / 100;
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

await waitForPortFree();
const server = spawn(
  process.execPath,
  ["scripts/serve-static.mjs", EXPORT_DIR, String(PORT)],
  {
    cwd: repoRoot,
    stdio: "ignore",
  },
);

let browser;
try {
  await waitForServer(server);
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
  const feedEvents = collectAnalytics(feed);
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
          document
            .querySelector('[data-active="true"]')
            ?.getAttribute("data-content-id") === "item_signal_3",
        null,
        { timeout: 5_000 },
      )
      .then(() => true)
      .catch(() => false);
    measured.scrollGestureMovedTo = await feed.evaluate(
      () =>
        document.querySelector('[data-active="true"]')?.getAttribute("data-content-id") ??
        null,
    );
    check(
      scrolled,
      `a scroll gesture did not move to item_signal_3 (on ${measured.scrollGestureMovedTo})`,
    );
    // Report only: from the first scroll event of the gesture, snap and
    // settle included, to the first frame (docs/standard.md §3).
    if (scrolled) {
      await sleep(1_500);
      const played = feedEvents.find(
        (event) =>
          event.name === "play" &&
          event.properties?.content_id === "item_signal_3" &&
          event.properties?.first_frame === true,
      );
      measured.scrollGestureSwipeToPlayMs = played?.properties?.swipe_to_play_ms ?? null;
    }
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
    ? {
        contentId: "item_stress_3_10",
        seriesId: "series_stress_3",
        episodeId: "ep_stress_3_10",
      }
    : { contentId: "item_signal_4", seriesId: "series_signal", episodeId: "ep_signal_4" };
  const resumeContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  await resumeContext.addInitScript(installPlayingProbe);
  await resumeContext.addInitScript(
    (snapshot) => {
      window.localStorage.setItem("project-flow.resume.v1", JSON.stringify(snapshot));
    },
    {
      ...resumeTarget,
      positionMs: 5_000,
      durationMs: 10_000,
      muted: true,
      captionsOn: false,
      updatedAt: Date.now(),
      completed: false,
    },
  );
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
    measured.resume.continueSeek = {
      beforeSeconds: beforeContinue,
      afterSeconds: afterContinue,
    };
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
    check(
      state?.muted === true,
      `autoplay on return is not muted (${JSON.stringify(state)})`,
    );
    await mutedContext.close();
  }

  // 11: a returning viewer who finished an episode lands on the next one.
  {
    const [finished, expectedNext] = SCALE
      ? [
          {
            contentId: "item_stress_3_10",
            seriesId: "series_stress_3",
            episodeId: "ep_stress_3_10",
          },
          "item_stress_3_11",
        ]
      : [
          {
            contentId: "item_signal_2",
            seriesId: "series_signal",
            episodeId: "ep_signal_2",
          },
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
          document.querySelector('[data-resume-offer="next_episode"]') !== null,
        expectedNext,
        { timeout: 8_000 },
      )
      .then(() => true)
      .catch(() => false);
    const firstPlayed = await page.evaluate(
      () => window.__flowPlaying[0]?.contentId ?? null,
    );
    measured.returnAfterFinishing = {
      finished: finished.contentId,
      expectedNext,
      landed,
      firstPlayed,
    };
    check(
      landed && firstPlayed === expectedNext,
      `after finishing ${finished.contentId} the viewer landed on ${firstPlayed}, not ${expectedNext} with its Next episode label`,
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
      if (pathname.includes("/hls/"))
        failedWhileOffline.push(pathname.replace(/^.*\/hls\//, ""));
    });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
      timeout: 10_000,
    });
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
            const played = window.__flowPlaying
              .slice(seen)
              .map((entry) => entry.contentId);
            if (played.includes("item_signal_3")) {
              resolveOutcome({
                result: "played",
                ms: Math.round(performance.now() - start),
              });
            } else if (errorShown && played.includes("item_signal_4")) {
              resolveOutcome({
                result: "error_then_skip",
                ms: Math.round(performance.now() - start),
              });
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
    measured.offlineWhileWarming = {
      ...outcome,
      failedMediaRequests: failedWhileOffline,
    };
    check(
      outcome.result === "played" || outcome.result === "error_then_skip",
      `after going offline while episode 3 warmed and coming back, it never played: ${JSON.stringify(outcome)}`,
    );
    await offlineContext.close();

    // 13: an episode whose media cannot load shows the error, then skips by itself.
    const brokenContext = await phoneContext(browser, null);
    const broken = await brokenContext.newPage();
    broken.on("pageerror", (error) =>
      consoleErrors.push(`broken episode: ${error.message}`),
    );
    await broken.route("**/hls/episode-3/**", (route) =>
      route.fulfill({ status: 404, body: "not found" }),
    );
    await broken.goto(`${BASE}/watch/signal-night/episode-3`, {
      waitUntil: "domcontentloaded",
    });
    const failure = await broken.evaluate(
      () =>
        new Promise((resolveFailure) => {
          const start = performance.now();
          let shownAt = null;
          const poll = () => {
            const active = document.querySelector('[data-active="true"]');
            const status = active?.querySelector('[role="status"]');
            if (status && shownAt === null) shownAt = performance.now();
            const skipped = window.__flowPlaying.find(
              (entry) => entry.contentId === "item_signal_4",
            );
            if (skipped) {
              resolveFailure({
                errorShownMs: shownAt === null ? null : Math.round(shownAt - start),
                errorVisibleForMs:
                  shownAt === null ? null : Math.round(skipped.at - shownAt),
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

  if (!SCALE) {
    // 14: an episode glimpsed for a second is not where a returning viewer lands.
    {
      const glimpseContext = await phoneContext(browser, null);
      const watching = await glimpseContext.newPage();
      trackPage(watching, "glimpse", consoleErrors, []);
      await watching.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await watching.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      await sleep(4_000);
      const glimpsed = await watching.evaluate(swipeAndWaitForPlaying, "item_signal_2");
      await sleep(1_000);
      const stored = await watching.evaluate(() =>
        JSON.parse(window.localStorage.getItem("project-flow.resume.v2") ?? "null"),
      );
      await watching.close();
      const returning = await glimpseContext.newPage();
      trackPage(returning, "return after a glimpse", consoleErrors, []);
      await returning.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await returning.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      await sleep(2_500);
      const reopened = await returning.evaluate(() => ({
        firstPlayed: window.__flowPlaying[0]?.contentId ?? null,
        active:
          document
            .querySelector('[data-active="true"]')
            ?.getAttribute("data-content-id") ?? null,
        strip: document.querySelector("[data-resume-offer]")?.textContent ?? null,
      }));
      const savedEntry = Array.isArray(stored?.entries)
        ? stored.entries[0]
        : Array.isArray(stored)
          ? stored[0]
          : stored;
      measured.returnAfterGlimpse = {
        glimpsed: glimpsed !== null,
        savedContentId: savedEntry?.contentId ?? null,
        savedPositionMs: savedEntry?.positionMs ?? null,
        ...reopened,
      };
      check(glimpsed !== null, "the glimpse check could not swipe to item_signal_2");
      check(
        reopened.firstPlayed === "item_signal_1" &&
          reopened.active === "item_signal_1" &&
          reopened.strip === null,
        `after glimpsing item_signal_2 for 1 s the viewer reopened on ${reopened.active} (strip: ${reopened.strip}), not the top of the feed without a strip`,
      );
      await glimpseContext.close();
    }

    // 15: leaving an auto-continued episode in its first second still reopens on it.
    {
      const continuedContext = await phoneContext(browser, null);
      const watching = await continuedContext.newPage();
      trackPage(watching, "auto-continue then leave", consoleErrors, []);
      await watching.goto(`${BASE}/watch/signal-night/episode-2`, {
        waitUntil: "domcontentloaded",
      });
      const continuedTo3 = await watching
        .waitForFunction(
          () => window.__flowPlaying.some((entry) => entry.contentId === "item_signal_3"),
          null,
          { timeout: 25_000 },
        )
        .then(() => true)
        .catch(() => false);
      await sleep(800);
      await watching.close();
      const returning = await continuedContext.newPage();
      trackPage(returning, "return after auto-continue", consoleErrors, []);
      await returning.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      const landed = await returning
        .waitForFunction(
          () =>
            window.__flowPlaying[0]?.contentId === "item_signal_3" &&
            document.querySelector('[data-resume-offer="next_episode"]') !== null,
          null,
          { timeout: 10_000 },
        )
        .then(() => true)
        .catch(() => false);
      const state = await returning.evaluate(() => ({
        firstPlayed: window.__flowPlaying[0]?.contentId ?? null,
        strip:
          document.querySelector('[data-resume-offer="next_episode"]')?.textContent ??
          null,
        stripHasButton:
          document.querySelector('[data-resume-offer="next_episode"] button') !== null,
      }));
      measured.returnAfterAutoContinue = { continuedTo3, landed, ...state };
      check(
        continuedTo3 &&
          landed &&
          state.strip?.startsWith("Next episode") === true &&
          !state.stripHasButton,
        `leaving episode 3 right after auto-continue reopened on ${state.firstPlayed} (label: ${state.strip}), not episode 3 with a Next episode label and no button`,
      );
      await continuedContext.close();
    }

    // 16: a playlist that answers 503 four times plays once it answers: the
    // player's own retries (1 s, then 3 s) run after hls.js gives up.
    {
      const flakyContext = await phoneContext(browser, null);
      const page = await flakyContext.newPage();
      page.on("pageerror", (error) =>
        consoleErrors.push(`flaky playlist: ${error.message}`),
      );
      const answers = [];
      const start = Date.now();
      await page.route("**/hls/episode-1/master.m3u8", async (route) => {
        const failing = answers.filter((answer) => answer.status === 503).length < 4;
        answers.push({ status: failing ? 503 : 200, at: Date.now() - start });
        if (failing) await route.fulfill({ status: 503, body: "busy" });
        else await route.continue();
      });
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      const played = await page
        .waitForFunction(
          () => window.__flowPlaying.some((entry) => entry.contentId === "item_signal_1"),
          null,
          { timeout: 25_000 },
        )
        .then(() => true)
        .catch(() => false);
      const playingAt = played ? Date.now() - start : null;
      const statusSeen = await page.evaluate(activeStatus);
      const gaps = answers.slice(1).map((answer, i) => answer.at - answers[i].at);
      measured.flakyPlaylist = {
        answers,
        gapsMs: gaps,
        playingAt,
        status: statusSeen.status,
      };
      check(
        played && answers.filter((answer) => answer.status === 503).length === 4,
        `a playlist that answered 503 four times did not play afterwards: ${JSON.stringify(measured.flakyPlaylist)}`,
      );
      check(
        gaps.some((gap) => gap >= 2_500),
        `the 3 s player retry never ran before the playlist was served: gaps ${gaps.join(", ")} ms`,
      );
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await flakyContext.close();
    }

    // 17: sound refused without a gesture: the next episode plays muted.
    {
      const soundContext = await phoneContext(browser, null);
      await soundContext.addInitScript(installPhoneAutoplayRule);
      const page = await soundContext.newPage();
      trackPage(page, "muted fallback", consoleErrors, []);
      const events = collectAnalytics(page);
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      // An untrusted key: the app turns sound on, the page has no gesture.
      await page.evaluate(() =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "m" })),
      );
      await sleep(300);
      const next = await page.evaluate(swipeAndWaitForPlaying, "item_signal_2");
      await sleep(1_000);
      const state = await page.evaluate(activeStatus);
      const fallback = events.some((event) => event.name === "autoplay_muted_fallback");
      measured.mutedFallback = {
        playedNext: next !== null,
        fallbackEvent: fallback,
        ...state,
      };
      check(
        next !== null &&
          state.active === "item_signal_2" &&
          state.muted === true &&
          state.paused === false,
        `with sound refused, the next episode did not play muted: ${JSON.stringify(measured.mutedFallback)}`,
      );
      check(fallback, "autoplay_muted_fallback was not sent when sound was refused");
      await soundContext.close();
    }

    // 18: a network that is "online" but carries nothing. Each episode shows
    // its error after the watchdog (10 s, re-attach, 10 s), the feed skips two
    // of them, then stops and waits for the viewer instead of running on.
    {
      const deadContext = await phoneContext(browser, null);
      const page = await deadContext.newPage();
      page.on("pageerror", (error) =>
        consoleErrors.push(`dead network: ${error.message}`),
      );
      await page.route("**/hls/**", () => {
        // Never answered.
      });
      const start = Date.now();
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      const timeline = [];
      let last = "";
      let heldAt = null;
      while (Date.now() - start < 110_000) {
        const state = await page.evaluate(activeStatus);
        const key = `${state.active}|${state.status ?? ""}`;
        if (key !== last) {
          last = key;
          timeline.push({
            at: Date.now() - start,
            active: state.active,
            status: state.status,
          });
        }
        if (heldAt === null && state.status?.includes("Connection problem"))
          heldAt = Date.now();
        if (heldAt !== null && Date.now() - heldAt >= 7_000) break;
        await sleep(250);
      }
      const final = await page.evaluate(activeStatus);
      const firstError = timeline.find((entry) => entry.status !== null);
      const skippedTo = [...new Set(timeline.map((entry) => entry.active))];
      measured.deadNetwork = { timeline, final };
      check(
        firstError !== undefined && firstError.at >= 15_000 && firstError.at <= 30_000,
        `with no data the first error was not shown after the watchdog (about 20 s): ${JSON.stringify(timeline)}`,
      );
      check(
        skippedTo.length === 3,
        `with no data the feed did not skip exactly two episodes before waiting: ${JSON.stringify(timeline)}`,
      );
      check(
        heldAt !== null &&
          final.status?.includes("Connection problem") === true &&
          final.active === skippedTo[2],
        `with no data the feed did not stop on a connection problem: ${JSON.stringify(final)}`,
      );
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await deadContext.close();
    }
  }

  if (!SCALE) {
    // 19: the first seconds. Muted, the dialogue is on screen in the app's own
    // layer above the title block; the browser draws no cue; one "Tap for
    // sound" cue shows, the first tap removes it and turns the sound on, and it
    // never comes back. The mute button does not pulse.
    {
      const firstContext = await phoneContext(browser, null);
      const page = await firstContext.newPage();
      trackPage(page, "first seconds", consoleErrors, []);
      const events = collectAnalytics(page);
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      const shown = await page
        .waitForFunction(
          () =>
            document.querySelector('[data-active="true"] [data-caption]')?.textContent ===
              "Something is wrong with the night." &&
            document.querySelector('[data-notice="sound"]') !== null,
          null,
          { timeout: 4_000 },
        )
        .then(() => true)
        .catch(() => false);
      const layout = await page.evaluate(() => {
        const active = document.querySelector('[data-active="true"]');
        const caption = active?.querySelector("[data-caption]")?.getBoundingClientRect();
        const position = active?.querySelector("[data-episode-position]");
        const video = active?.querySelector("video");
        const mute = active?.querySelector('[aria-label="Mute"][aria-pressed="true"]');
        return {
          captionBottom: caption ? Math.round(caption.bottom) : null,
          captionTop: caption ? Math.round(caption.top) : null,
          positionTop: position ? Math.round(position.getBoundingClientRect().top) : null,
          position: position?.querySelector('[aria-hidden="true"]')?.textContent ?? null,
          positionLabel: position?.textContent ?? null,
          trackModes: video ? [...video.textTracks].map((track) => track.mode) : [],
          notice: document.querySelector('[data-notice="sound"]')?.textContent ?? null,
          muteAnimation: mute ? getComputedStyle(mute).animationName : null,
        };
      });
      await page.mouse.click(120, 300);
      await sleep(400);
      const afterTap = await page.evaluate(() => ({
        notice: document.querySelector('[data-notice="sound"]') !== null,
        muted: document.querySelector('[data-active="true"] video')?.muted ?? null,
        caption: document.querySelector('[data-active="true"] [data-caption]') !== null,
      }));
      await sleep(5_000);
      const later = await page.evaluate(
        () => document.querySelector("[data-notice]") !== null,
      );
      const cueShown = events.filter((event) => event.name === "sound_cue_shown").length;
      const soundToggled = events.find((event) => event.name === "sound_toggled");
      measured.firstSeconds = { shown, layout, afterTap, cueBackLater: later, cueShown };
      check(
        shown,
        `muted cold open: no caption layer or no sound cue within 4 s (${JSON.stringify(layout)})`,
      );
      check(
        layout.captionBottom !== null &&
          layout.positionTop !== null &&
          layout.captionBottom <= layout.positionTop &&
          layout.captionTop >= 0,
        `captions are not above the title block: ${JSON.stringify(layout)}`,
      );
      check(
        layout.trackModes.length > 0 &&
          layout.trackModes.every((mode) => mode === "hidden"),
        `the browser still draws cues itself: track modes ${layout.trackModes.join(", ")}`,
      );
      check(
        layout.position === "Episode 1 / 5",
        `episode position reads "${layout.position}"`,
      );
      check(
        layout.muteAnimation === "none",
        `the mute button still animates (${layout.muteAnimation})`,
      );
      check(
        !afterTap.notice && afterTap.muted === false && !afterTap.caption,
        `the first tap did not remove the cue, turn sound on and hand captions back to the sound: ${JSON.stringify(afterTap)}`,
      );
      check(!later, "a notice came back after the sound was turned on");
      check(cueShown === 1, `sound_cue_shown sent ${cueShown} times`);
      check(
        soundToggled?.properties?.source === "surface" &&
          soundToggled?.properties?.muted === false,
        `sound_toggled missing or wrong: ${JSON.stringify(soundToggled ?? null)}`,
      );
      await firstContext.close();
    }

    // 20: an explicit caption choice wins over the sound and survives a reload.
    {
      const choiceContext = await phoneContext(browser, null);
      const page = await choiceContext.newPage();
      trackPage(page, "caption choice", consoleErrors, []);
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      await page.click(
        '[data-active="true"] [aria-label="Captions"][aria-pressed="true"]',
      );
      const stored = await page.evaluate(() =>
        window.localStorage.getItem("project-flow.captions.v1"),
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      await page.waitForFunction(
        () =>
          (document.querySelector('[data-active="true"] video')?.currentTime ?? 0) >= 1.2,
        null,
        { timeout: 8_000 },
      );
      const reloaded = await page.evaluate(() => ({
        muted: document.querySelector('[data-active="true"] video')?.muted ?? null,
        caption: document.querySelector('[data-active="true"] [data-caption]') !== null,
        toggle:
          document.querySelector(
            '[data-active="true"] [aria-label="Captions"][aria-pressed="false"]',
          ) !== null,
      }));
      measured.captionChoice = { stored, reloaded };
      check(
        stored === "off" &&
          reloaded.muted === true &&
          !reloaded.caption &&
          reloaded.toggle,
        `captions turned off by the viewer came back while muted: ${JSON.stringify(measured.captionChoice)}`,
      );
      await choiceContext.close();
    }

    // 21: sharing says what happened. A copied link shows "Link copied" in a
    // status region; closing the share sheet copies nothing.
    {
      const copyContext = await phoneContext(browser, null);
      await copyContext.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "share", {
          value: undefined,
          configurable: true,
        });
        window.__flowCopied = [];
        Object.defineProperty(Navigator.prototype, "clipboard", {
          configurable: true,
          get: () => ({
            writeText: (text) => {
              window.__flowCopied.push(text);
              return Promise.resolve();
            },
          }),
        });
      });
      const page = await copyContext.newPage();
      trackPage(page, "share copy", consoleErrors, []);
      const events = collectAnalytics(page);
      await page.goto(`${BASE}/watch/signal-night/episode-2`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      await page.waitForFunction(
        () =>
          (document.querySelector('[data-active="true"] video')?.currentTime ?? 0) >= 7,
        null,
        { timeout: 10_000 },
      );
      await page.click('[data-active="true"] [aria-label="Share"]');
      const copied = await page
        .waitForFunction(
          () =>
            document.querySelector('[data-notice="share_copied"]')?.textContent ===
              "Link copied" &&
            [...document.querySelectorAll('[role="status"]')].some(
              (region) => region.textContent === "Link copied",
            ),
          null,
          { timeout: 2_000 },
        )
        .then(() => true)
        .catch(() => false);
      const link = await page.evaluate(() => window.__flowCopied[0] ?? null);
      const startSeconds = link ? new URL(link).searchParams.get("t") : null;
      await sleep(2_300);
      const gone = await page.evaluate(
        () => document.querySelector("[data-notice]") === null,
      );
      measured.shareCopy = { copied, link, gone };
      check(copied, 'copying a link showed no "Link copied" status');
      check(
        link?.includes("/watch/signal-night/episode-2") === true &&
          Number(startSeconds) >= 3,
        `the copied link is not the episode at the shared moment: ${link}`,
      );
      check(gone, "the Link copied notice did not leave on its own");
      check(
        events.some((event) => event.name === "share_copy"),
        "share_copy was not sent after copying",
      );
      await copyContext.close();

      const cancelContext = await phoneContext(browser, null);
      await cancelContext.addInitScript(() => {
        window.__flowCopied = [];
        Object.defineProperty(Navigator.prototype, "share", {
          configurable: true,
          value: () => Promise.reject(new DOMException("closed", "AbortError")),
        });
        Object.defineProperty(Navigator.prototype, "clipboard", {
          configurable: true,
          get: () => ({
            writeText: (text) => {
              window.__flowCopied.push(text);
              return Promise.resolve();
            },
          }),
        });
      });
      const cancelled = await cancelContext.newPage();
      trackPage(cancelled, "share cancel", consoleErrors, []);
      const cancelEvents = collectAnalytics(cancelled);
      await cancelled.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await cancelled.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      await cancelled.click('[data-active="true"] [aria-label="Share"]');
      await sleep(600);
      const state = await cancelled.evaluate(() => ({
        copied: window.__flowCopied.length,
        notice: document.querySelector('[data-notice^="share"]') !== null,
      }));
      measured.shareCancel = state;
      check(
        state.copied === 0 &&
          !state.notice &&
          cancelEvents.some((event) => event.name === "share_cancel"),
        `closing the share sheet still copied or announced something: ${JSON.stringify(state)}`,
      );
      await cancelContext.close();
    }

    // 22: a shared moment opens there, still as an autoplay, with no offer.
    {
      const momentContext = await phoneContext(browser, null);
      const page = await momentContext.newPage();
      trackPage(page, "timestamped share", consoleErrors, []);
      await page.goto(`${BASE}/watch/signal-night/episode-3?t=4&utm_source=share`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      const at = await page.evaluate(() => ({
        active:
          document
            .querySelector('[data-active="true"]')
            ?.getAttribute("data-content-id") ?? null,
        seconds:
          document.querySelector('[data-active="true"] video')?.currentTime ?? null,
        offer: document.querySelector("[data-resume-offer]") !== null,
      }));
      measured.timestampedShare = at;
      check(
        at.active === "item_signal_3" &&
          at.seconds !== null &&
          at.seconds >= 3.9 &&
          !at.offer,
        `a link shared at 4 s did not open there: ${JSON.stringify(at)}`,
      );
      await momentContext.close();
    }

    // 23: a pause the viewer asked for shows a play glyph; playing again removes it.
    {
      const pauseContext = await phoneContext(browser, null);
      const page = await pauseContext.newPage();
      trackPage(page, "pause glyph", consoleErrors, []);
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      await page.mouse.click(120, 300); // sound on
      await sleep(400);
      await page.mouse.click(120, 300); // pause
      await sleep(400);
      const paused = await page.evaluate(() => ({
        paused: document.querySelector('[data-active="true"] video')?.paused ?? null,
        glyph:
          document.querySelector('[data-active="true"] [data-paused-glyph]') !== null,
      }));
      await page.mouse.click(120, 300); // play
      await sleep(400);
      const resumed = await page.evaluate(() => ({
        paused: document.querySelector('[data-active="true"] video')?.paused ?? null,
        glyph:
          document.querySelector('[data-active="true"] [data-paused-glyph]') !== null,
      }));
      measured.pauseGlyph = { paused, resumed };
      check(
        paused.paused === true &&
          paused.glyph &&
          resumed.paused === false &&
          !resumed.glyph,
        `pause did not show the play glyph or play did not remove it: ${JSON.stringify(measured.pauseGlyph)}`,
      );
      await pauseContext.close();
    }
  }

  // 24: the end of a series is a handoff: share and follow, and another story
  // only on an explicit tap. Nothing starts by itself.
  {
    const endPath = SCALE
      ? "/watch/stress-2/episode-60"
      : "/watch/signal-night/episode-5";
    const endId = SCALE ? "item_stress_2_60" : "item_signal_5";
    const endContext = await phoneContext(browser, null);
    const page = await endContext.newPage();
    trackPage(page, "series end", consoleErrors, []);
    const events = collectAnalytics(page);
    await page.goto(`${BASE}${endPath}`, { waitUntil: "domcontentloaded" });
    const ended = await page
      .waitForSelector('[data-series-end="series_complete"]', { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    const playsAtEnd = await page.evaluate(() => window.__flowPlaying.length);
    await sleep(6_000);
    const surface = await page.evaluate(() => {
      const end = document.querySelector("[data-series-end]");
      return {
        text: end?.textContent ?? null,
        active:
          document
            .querySelector('[data-active="true"]')
            ?.getAttribute("data-content-id") ?? null,
        plays: window.__flowPlaying.length,
        share: [...(end?.querySelectorAll("button") ?? [])].some(
          (button) => button.textContent === "Share this story",
        ),
        follow: [...(end?.querySelectorAll("button") ?? [])].some(
          (button) => button.textContent === "Follow series",
        ),
        nextStory:
          end?.querySelector("[data-next-story]")?.getAttribute("data-next-story") ??
          null,
      };
    });
    measured.seriesEnd = { ended, ...surface, playsAtEnd };
    check(ended, `the end of the series never showed on ${endPath}`);
    check(
      surface.text?.includes("Series complete") === true &&
        surface.share &&
        surface.follow,
      `the series end lacks its label, share or follow: ${JSON.stringify(surface)}`,
    );
    check(
      surface.active === endId && surface.plays === playsAtEnd,
      `something started by itself after the series ended: ${JSON.stringify(surface)}`,
    );
    const offered = events.find((event) => event.name === "next_story_offered");
    check(
      offered !== undefined &&
        (offered.properties?.next_content_id ?? null) === surface.nextStory,
      `next_story_offered missing or not what was shown: ${JSON.stringify(offered ?? null)}`,
    );
    if (SCALE) {
      check(
        surface.nextStory !== null &&
          /^item_stress_\d+_1$/.test(surface.nextStory) &&
          !surface.nextStory.startsWith("item_stress_2_"),
        `the series end did not offer another story from its first episode: ${surface.nextStory}`,
      );
      if (surface.nextStory) {
        await page.click("[data-next-story]");
        const opened = await page
          .waitForFunction(
            (id) => window.__flowPlaying.some((entry) => entry.contentId === id),
            surface.nextStory,
            { timeout: 10_000 },
          )
          .then(() => true)
          .catch(() => false);
        measured.seriesEnd.nextStoryPlayed = opened;
        check(opened, `tapping the next story did not play ${surface.nextStory}`);
        check(
          events.some((event) => event.name === "next_story_open"),
          "next_story_open was not sent",
        );
      }
    } else {
      check(
        surface.nextStory === null &&
          surface.text?.includes("every story we have") === true,
        `with a single series the end does not say so honestly: ${JSON.stringify(surface)}`,
      );
      await page.click('[data-series-end] [aria-pressed="false"]');
      const following = await page.evaluate(
        () =>
          document.querySelector("[data-series-end] [aria-pressed]")?.textContent ?? null,
      );
      check(
        following === "Following",
        `Follow on the series end did not follow (${following})`,
      );
    }
    await endContext.close();
  }

  // 25: a landscape phone (812x375: the 9:16 frame is 211 px wide). The end of
  // the series stays inside the screen, its actions are the topmost element
  // where they are drawn, and the next story is reachable by scrolling (R3A-01).
  {
    const endPath = SCALE
      ? "/watch/stress-2/episode-60"
      : "/watch/signal-night/episode-5";
    const landscape = await browser.newContext({
      viewport: { width: 812, height: 375 },
      isMobile: true,
      hasTouch: true,
    });
    await landscape.addInitScript(installPlayingProbe);
    const page = await landscape.newPage();
    trackPage(page, "series end landscape", consoleErrors, []);
    await page.goto(`${BASE}${endPath}`, { waitUntil: "domcontentloaded" });
    const ended = await page
      .waitForSelector("[data-series-end]", { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    await sleep(900);
    const reach = await page.evaluate(() => {
      const end = document.querySelector("[data-series-end]");
      const onTop = (element) => {
        if (!element) return null;
        const box = element.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        return {
          top: Math.round(box.top),
          bottom: Math.round(box.bottom),
          inside: box.top >= 0 && box.bottom <= window.innerHeight,
          hit: element.contains(document.elementFromPoint(x, y)),
        };
      };
      const buttons = [...(end?.querySelectorAll("button") ?? [])];
      const label = end?.querySelector("p") ?? null;
      const share = buttons.find((b) => b.textContent === "Share this story") ?? null;
      const close = end?.querySelector('[aria-label="Close"]') ?? null;
      const last =
        end?.querySelector("[data-next-story]") ??
        end?.lastElementChild?.lastElementChild ??
        null;
      const before = { label: onTop(label), share: onTop(share), close: onTop(close) };
      last?.scrollIntoView({ block: "end" });
      // A label that runs past its button is cut: every action fits on its line.
      const overflowing = buttons
        .filter((button) => button.scrollWidth > button.clientWidth + 1)
        .map((button) => button.textContent);
      return { ...before, last: onTop(last), overflowing };
    });
    measured.seriesEndLandscape = { ended, ...reach };
    check(ended, `the end of the series never showed at 812x375 on ${endPath}`);
    for (const part of ["label", "share", "close", "last"]) {
      check(
        reach[part]?.inside === true && reach[part]?.hit === true,
        `at 812x375 the series end ${part} is clipped or covered: ${JSON.stringify(reach[part] ?? null)}`,
      );
    }
    check(
      reach.overflowing.length === 0,
      `at 812x375 a series end action runs past its button: ${JSON.stringify(reach.overflowing)}`,
    );
    await landscape.close();
  }

  if (!SCALE) {
    // 26: the same landscape phone at the cold open: the caption stays inside
    // the frame, below the "Tap for sound" slot and left of the rail (R3A-01).
    {
      const landscape = await browser.newContext({
        viewport: { width: 812, height: 375 },
        isMobile: true,
        hasTouch: true,
      });
      await landscape.addInitScript(installPlayingProbe);
      const page = await landscape.newPage();
      trackPage(page, "cold open landscape", consoleErrors, []);
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      const shown = await page
        .waitForFunction(
          () =>
            document.querySelector('[data-active="true"] [data-caption]') !== null &&
            document.querySelector('[data-notice="sound"]') !== null,
          null,
          { timeout: 10_000 },
        )
        .then(() => true)
        .catch(() => false);
      const boxes = await page.evaluate(() => {
        const rect = (selector) => {
          const box = document.querySelector(selector)?.getBoundingClientRect();
          return box
            ? {
                left: Math.round(box.left),
                top: Math.round(box.top),
                right: Math.round(box.right),
                bottom: Math.round(box.bottom),
              }
            : null;
        };
        return {
          caption: rect('[data-active="true"] [data-caption]'),
          notice: rect('[data-notice="sound"]'),
          rail: rect('[data-active="true"] [role="toolbar"]'),
          viewportHeight: window.innerHeight,
        };
      });
      measured.coldOpenLandscape = { shown, ...boxes };
      const { caption, notice, rail } = boxes;
      check(
        shown &&
          caption !== null &&
          notice !== null &&
          rail !== null &&
          caption.top >= notice.bottom &&
          caption.bottom <= boxes.viewportHeight &&
          caption.right <= rail.left &&
          rail.top >= 0,
        `at 812x375 the caption is clipped, under the notice or under the rail: ${JSON.stringify(measured.coldOpenLandscape)}`,
      );
      await landscape.close();
    }

    // 27: one slot at the top. A notice replaces the "Next episode" label
    // instead of drawing over it, and when the label fades by itself a few
    // seconds in, "Tap for sound" does not interrupt the episode (R3A-02).
    {
      const finished = {
        contentId: "item_signal_1",
        seriesId: "series_signal",
        episodeId: "ep_signal_1",
        positionMs: 10_000,
        durationMs: 10_000,
        muted: true,
        captionsOn: false,
        completed: true,
        updatedAt: Date.now(),
      };
      const slotContext = await phoneContext(browser, finished);
      await slotContext.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "share", {
          value: undefined,
          configurable: true,
        });
        Object.defineProperty(Navigator.prototype, "clipboard", {
          configurable: true,
          get: () => ({ writeText: () => Promise.resolve() }),
        });
      });
      const page = await slotContext.newPage();
      trackPage(page, "notice slot", consoleErrors, []);
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      const labelled = await page
        .waitForSelector('[data-resume-offer="next_episode"]', { timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      await sleep(700);
      await page.click('[data-active="true"] [aria-label="Share"]');
      await page
        .waitForSelector('[data-notice="share_copied"]', { timeout: 2_000 })
        .catch(() => null);
      const together = await page.evaluate(() => ({
        notice:
          document.querySelector("[data-notice]")?.getAttribute("data-notice") ?? null,
        label: document.querySelector('[data-resume-offer="next_episode"]') !== null,
      }));
      measured.noticeSlot = { labelled, together };
      check(
        labelled && together.notice === "share_copied" && !together.label,
        `the "Next episode" label and a notice share the top slot: ${JSON.stringify(measured.noticeSlot)}`,
      );
      await slotContext.close();

      const lateContext = await phoneContext(browser, {
        ...finished,
        updatedAt: Date.now(),
      });
      const late = await lateContext.newPage();
      trackPage(late, "late sound cue", consoleErrors, []);
      const events = collectAnalytics(late);
      await late.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await late
        .waitForSelector('[data-resume-offer="next_episode"]', { timeout: 10_000 })
        .catch(() => null);
      await sleep(6_500);
      const lateCue = {
        label: await late.evaluate(
          () => document.querySelector('[data-resume-offer="next_episode"]') !== null,
        ),
        cues: events.filter((event) => event.name === "sound_cue_shown").length,
      };
      measured.lateSoundCue = lateCue;
      check(
        !lateCue.label && lateCue.cues === 0,
        `"Tap for sound" interrupted an episode already under way: ${JSON.stringify(lateCue)}`,
      );
      await lateContext.close();
    }

    // 28: when the clipboard refuses, the link is a real, reachable field (not
    // hidden from assistive tech) and it stays while it has focus (R3A-04).
    {
      const failContext = await phoneContext(browser, null);
      await failContext.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "share", {
          value: undefined,
          configurable: true,
        });
        Object.defineProperty(Navigator.prototype, "clipboard", {
          configurable: true,
          get: () => ({ writeText: () => Promise.reject(new Error("refused")) }),
        });
      });
      const page = await failContext.newPage();
      trackPage(page, "share failed", consoleErrors, []);
      await page.goto(`${BASE}/watch/signal-night/episode-2`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      await page.click('[data-active="true"] [aria-label="Share"]');
      const field = await page
        .waitForSelector("[data-notice-detail]", { timeout: 2_000 })
        .then(() =>
          page.evaluate(() => {
            const input = document.querySelector("[data-notice-detail]");
            return {
              value: input?.value ?? null,
              label: input?.getAttribute("aria-label") ?? null,
              hidden: input?.closest('[aria-hidden="true"]') !== null,
            };
          }),
        )
        .catch(() => null);
      await page.focus("[data-notice-detail]").catch(() => null);
      const selected = await page.evaluate(() => {
        const input = document.querySelector("[data-notice-detail]");
        return input
          ? input.selectionEnd - input.selectionStart === input.value.length
          : false;
      });
      await sleep(7_000);
      const heldAfter7s = await page.evaluate(
        () => document.querySelector('[data-notice="share_failed"]') !== null,
      );
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.getSelection()?.removeAllRanges();
      });
      const released = await page
        .waitForFunction(() => document.querySelector("[data-notice]") === null, null, {
          timeout: 2_500,
        })
        .then(() => true)
        .catch(() => false);
      measured.shareFailed = { field, selected, heldAfter7s, released };
      check(
        field !== null &&
          // The 10 s episode may have continued to the next one before the tap.
          /\/watch\/signal-night\/episode-\d+\?/.test(field.value ?? "") &&
          field.label === "Link to copy" &&
          !field.hidden &&
          selected,
        `the link shown when copying fails is not a reachable, selected field: ${JSON.stringify(measured.shareFailed)}`,
      );
      check(
        heldAfter7s && released,
        `the failed-copy link left while focused, or stayed after: ${JSON.stringify(measured.shareFailed)}`,
      );
      await failContext.close();
    }

    // 29, 31, 32: keys on a focused rail button, fixed names, episode changes
    // announced and followed by focus (A11Y-02, A11Y-07, A11Y-09).
    {
      const keysContext = await phoneContext(browser, null);
      const page = await keysContext.newPage();
      trackPage(page, "keyboard rail", consoleErrors, []);
      await page.goto(`${BASE}/watch/signal-night/episode-2`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      await page.waitForFunction(
        () =>
          (document.querySelector('[data-active="true"] video')?.currentTime ?? 0) > 0.3,
        null,
        { timeout: 8_000 },
      );
      const rail = () =>
        page.evaluate(() =>
          [
            ...document.querySelectorAll('[data-active="true"] [role="toolbar"] button'),
          ].map((button) => [
            button.getAttribute("aria-label"),
            button.getAttribute("aria-pressed"),
          ]),
        );
      const railBefore = await rail();
      await page.focus('[data-active="true"] [data-action="like"]');
      await page.keyboard.press("Space");
      await sleep(250);
      const afterSpace = await page.evaluate(() => ({
        liked:
          document
            .querySelector('[data-active="true"] [data-action="like"]')
            ?.getAttribute("aria-pressed") ?? null,
        paused: document.querySelector('[data-active="true"] video')?.paused ?? null,
      }));
      const railAfter = await rail();
      measured.keyboardRail = { afterSpace, railBefore, railAfter };
      check(
        afterSpace.liked === "true" && afterSpace.paused === false,
        `Space on the focused Like button did not like, or paused the episode: ${JSON.stringify(afterSpace)}`,
      );
      check(
        railBefore.length > 0 &&
          railBefore.every(([label], i) => railAfter[i]?.[0] === label) &&
          railBefore.some(([label, pressed]) => label === "Mute" && pressed === "true") &&
          railAfter.some(([label, pressed]) => label === "Like" && pressed === "true"),
        `a rail toggle changes its name with its state: ${JSON.stringify(measured.keyboardRail)}`,
      );

      // Focus is on Like; the arrow moves to the next episode and focus follows.
      await page.keyboard.press("ArrowDown");
      const moved = await page
        .waitForFunction(
          () =>
            document
              .querySelector('[data-active="true"]')
              ?.getAttribute("data-content-id") === "item_signal_3",
          null,
          { timeout: 5_000 },
        )
        .then(() => true)
        .catch(() => false);
      await sleep(300);
      const announced = await page.evaluate(() => {
        const active = document.querySelector('[data-active="true"]');
        const region = document.querySelector("[data-episode-announcer]");
        return {
          region: region?.textContent ?? null,
          polite: region?.getAttribute("aria-live") ?? null,
          articleLabel: active?.getAttribute("aria-label") ?? null,
          posinset: active?.getAttribute("aria-posinset") ?? null,
          focusOnSlide: document.activeElement === active,
        };
      });
      measured.episodeAnnounced = { moved, ...announced };
      check(
        moved &&
          announced.region === "Signal Night, Episode 3 of 5" &&
          announced.polite === "polite" &&
          announced.articleLabel === "Signal Night, Episode 3 of 5" &&
          announced.posinset !== null,
        `an episode change is not announced or the slide has no name: ${JSON.stringify(measured.episodeAnnounced)}`,
      );
      check(
        announced.focusOnSlide,
        `focus fell back to the page when the rail it was on left: ${JSON.stringify(measured.episodeAnnounced)}`,
      );

      // 35: touch feedback on mute (the pulse no longer owns transform).
      const muteBox = await page
        .locator('[data-active="true"] [data-action="mute"]')
        .boundingBox();
      let pressedTransform = null;
      if (muteBox) {
        await page.mouse.move(
          muteBox.x + muteBox.width / 2,
          muteBox.y + muteBox.height / 2,
        );
        await page.mouse.down();
        await sleep(250);
        pressedTransform = await page.evaluate(
          () =>
            getComputedStyle(
              document.querySelector('[data-active="true"] [data-action="mute"]'),
            ).transform,
        );
        await page.mouse.up();
      }
      const scale = /matrix\(([\d.]+)/.exec(pressedTransform ?? "")?.[1];
      measured.mutePressFeedback = pressedTransform;
      check(
        scale !== undefined && Number(scale) < 0.95,
        `the mute button gives no press feedback (transform ${pressedTransform})`,
      );
      await keysContext.close();
    }

    // 30: the Tune sheet is a real dialog (A11Y-02, UX-09).
    {
      const sheetContext = await phoneContext(browser, null);
      const page = await sheetContext.newPage();
      trackPage(page, "tune dialog", consoleErrors, []);
      const events = collectAnalytics(page);
      await page.goto(`${BASE}/watch/signal-night/episode-2`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      const state = () =>
        page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]');
          const active = document.activeElement;
          return {
            open: dialog !== null,
            modal: dialog?.getAttribute("aria-modal") ?? null,
            focusInside: dialog !== null && dialog.contains(active),
            focusOnChip: active?.hasAttribute("data-intent-chip") === true,
            focusOnTune: active?.getAttribute("data-action") === "tune",
            feedInert: document.querySelector('[role="feed"]')?.inert === true,
            slide:
              document
                .querySelector('[data-active="true"]')
                ?.getAttribute("data-content-id") ?? null,
            muted: document.querySelector('[data-active="true"] video')?.muted ?? null,
          };
        });
      await page.focus('[data-active="true"] [data-action="tune"]');
      await page.keyboard.press("Enter");
      await page.waitForSelector('[role="dialog"]', { timeout: 2_000 }).catch(() => null);
      const opened = await state();
      for (let i = 0; i < 9; i += 1) await page.keyboard.press("Tab");
      const afterTabs = await state();
      await page.keyboard.press("Shift+Tab");
      const afterShiftTab = await state();
      // The inert feed alone does not trap Tab: past the last chip the browser
      // would move focus out of the page. The sheet must wrap it both ways.
      const focusedName = () =>
        page.evaluate(
          () =>
            document.activeElement?.getAttribute("data-intent-chip") ??
            document.activeElement?.getAttribute("aria-label") ??
            null,
        );
      await page.focus('[role="dialog"] [data-intent-chip="SURPRISE_ME"]');
      await page.keyboard.press("Tab");
      const wrapForward = await focusedName();
      await page.keyboard.press("Shift+Tab");
      const wrapBackward = await focusedName();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("m");
      await sleep(400);
      const afterFeedKeys = await state();
      // Escape at document level: focus is not in the sheet.
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press("Escape");
      await sleep(150);
      const afterEscape = await state();
      // A sheet Escape failed to close would block every later tap and abort
      // the run: close it by hand so the remaining checks still report.
      if (afterEscape.open) {
        await page
          .click('[role="dialog"] [aria-label="Close"]', { timeout: 2_000 })
          .catch(() => null);
        await page.keyboard.press("Escape");
        await sleep(150);
      }
      await page.click('[data-active="true"] [data-action="tune"]');
      await page.waitForSelector('[role="dialog"]', { timeout: 2_000 }).catch(() => null);
      const closeVisible = await page.isVisible('[role="dialog"] [aria-label="Close"]');
      await page.click('[role="dialog"] [aria-label="Close"]');
      await sleep(150);
      const afterClose = await state();
      await page.click('[data-active="true"] [data-action="tune"]');
      await page.click('[data-intent-chip="DARKER"]');
      const confirmation = await page
        .waitForSelector('[data-notice="intent"]', { timeout: 5_000 })
        .then((element) => element.textContent())
        .catch(() => null);
      const sent = events.map((event) => event.name);
      measured.tuneDialog = {
        opened,
        afterTabs,
        afterShiftTab,
        afterFeedKeys,
        afterEscape,
        closeVisible,
        afterClose,
        confirmation,
        wrapForward,
        wrapBackward,
      };
      check(
        opened.open && opened.modal === "true" && opened.focusOnChip && opened.feedInert,
        `opening Tune did not move focus into a modal sheet: ${JSON.stringify(opened)}`,
      );
      check(
        afterTabs.focusInside &&
          afterShiftTab.focusInside &&
          wrapForward === "Close" &&
          wrapBackward === "SURPRISE_ME",
        `Tab left the Tune sheet: ${JSON.stringify({ afterTabs, afterShiftTab, wrapForward, wrapBackward })}`,
      );
      check(
        afterFeedKeys.open &&
          afterFeedKeys.slide === opened.slide &&
          afterFeedKeys.muted === opened.muted,
        `keys changed the feed behind the open sheet: ${JSON.stringify({ opened, afterFeedKeys })}`,
      );
      check(
        !afterEscape.open && afterEscape.focusOnTune && !afterEscape.feedInert,
        `Escape did not close the sheet from outside it or focus did not return to Tune: ${JSON.stringify(afterEscape)}`,
      );
      check(
        closeVisible && !afterClose.open,
        `the Tune sheet has no working Close control: ${JSON.stringify({ closeVisible, afterClose })}`,
      );
      check(
        typeof confirmation === "string" &&
          /up next|Nothing new for that yet/.test(confirmation),
        `choosing a chip said nothing: ${JSON.stringify(confirmation)}`,
      );
      check(
        sent.filter((name) => name === "intent_open").length === 3 &&
          sent.includes("intent_select"),
        `intent events are not one per open and one per choice: ${JSON.stringify(sent.filter((name) => name.startsWith("intent")))}`,
      );
      await sheetContext.close();

      // The same sheet in the short landscape frame (R3B-01). There the stage
      // is about 200 px wide, the six chips wrap to six rows, and an unbounded
      // sheet took its title and its Close button off the top of the screen and
      // left no backdrop to tap — a touch-only viewer could not dismiss it.
      const shortFrames = {};
      for (const viewport of [
        { width: 740, height: 360 },
        { width: 568, height: 320 },
      ]) {
        const shortContext = await browser.newContext({
          viewport,
          isMobile: true,
          hasTouch: true,
        });
        await shortContext.addInitScript(installPlayingProbe);
        const short = await shortContext.newPage();
        trackPage(short, `tune ${viewport.width}x${viewport.height}`, consoleErrors, []);
        await short.goto(`${BASE}/watch/signal-night/episode-2`, {
          waitUntil: "domcontentloaded",
        });
        await short.waitForFunction(() => window.__flowPlaying.length > 0, null, {
          timeout: 10_000,
        });
        await short.click('[data-active="true"] [data-action="tune"]');
        await short
          .waitForSelector('[role="dialog"]', { timeout: 2_000 })
          .catch(() => null);
        await sleep(400);
        const frame = await short.evaluate(() => {
          const top = (selector) => {
            const element = document.querySelector(selector);
            return element ? Math.round(element.getBoundingClientRect().top) : null;
          };
          const sheet = document
            .querySelector('[data-intent-sheet="true"]')
            ?.getBoundingClientRect();
          const chip = document
            .querySelector("[data-intent-chip]")
            ?.getBoundingClientRect();
          return {
            title: top("#intent-sheet-title"),
            close: top('[role="dialog"] [aria-label="Close"]'),
            chipTop: chip ? Math.round(chip.top) : null,
            chipBottom: chip ? Math.round(chip.bottom) : null,
            // The band of backdrop left above the sheet: what a finger taps.
            band: sheet ? Math.round(sheet.top) : null,
            sheetBottom: sheet ? Math.round(sheet.bottom) : null,
            height: window.innerHeight,
          };
        });
        // The chips are the part that gives way: the last one has to be
        // reachable, and to land inside the frame once it is scrolled to.
        frame.lastChip = await short.evaluate(() => {
          const chips = [...document.querySelectorAll("[data-intent-chip]")];
          const row = chips[0]?.parentElement;
          if (!row || chips.length === 0) return null;
          row.scrollTop = row.scrollHeight;
          const box = chips[chips.length - 1].getBoundingClientRect();
          return {
            count: chips.length,
            top: Math.round(box.top),
            bottom: Math.round(box.bottom),
            scrollable: row.scrollHeight > row.clientHeight,
          };
        });
        // Tap that band: the sheet must go.
        await short.mouse.click(Math.round(viewport.width / 2), 20);
        await sleep(300);
        frame.closedByTap = await short.evaluate(
          () => document.querySelector('[role="dialog"]') === null,
        );
        shortFrames[`${viewport.width}x${viewport.height}`] = frame;
        await shortContext.close();
      }
      measured.tuneShortFrames = shortFrames;
      check(
        Object.values(shortFrames).every(
          (frame) =>
            frame.title !== null &&
            frame.title >= 0 &&
            frame.close !== null &&
            frame.close >= 0 &&
            frame.chipTop !== null &&
            frame.chipTop >= 0 &&
            frame.chipBottom <= frame.height &&
            frame.sheetBottom !== null &&
            frame.sheetBottom <= frame.height &&
            frame.band >= 44 &&
            frame.lastChip !== null &&
            frame.lastChip.scrollable &&
            frame.lastChip.top >= 0 &&
            frame.lastChip.bottom <= frame.height &&
            frame.closedByTap,
        ),
        `in a short landscape frame the Tune sheet runs off the screen or cannot be dismissed by tapping: ${JSON.stringify(shortFrames)}`,
      );
    }

    // 33: a phone in landscape narrower than 768 px (740x360) and a portrait
    // phone: the 9:16 frame (A11Y-03), and then, with a notch emulated so the
    // insets are not 0, no page scroll outside the feed (A11Y-05) and chrome
    // that clears the notch on the sides as well (R3B-03).
    {
      const frames = {};
      for (const viewport of [
        { width: 740, height: 360 },
        { width: 375, height: 812 },
      ]) {
        const frameContext = await browser.newContext({
          viewport,
          isMobile: true,
          hasTouch: true,
        });
        await frameContext.addInitScript(installPlayingProbe);
        const page = await frameContext.newPage();
        trackPage(page, `frame ${viewport.width}x${viewport.height}`, consoleErrors, []);
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
          timeout: 10_000,
        });
        frames[`${viewport.width}x${viewport.height}`] = await page.evaluate(() => {
          const stage = document.querySelector('[role="feed"]')?.parentElement;
          const box = stage?.getBoundingClientRect();
          const rail = document
            .querySelector('[data-active="true"] [role="toolbar"]')
            ?.getBoundingClientRect();
          return {
            stage: box
              ? [
                  Math.round(box.left),
                  Math.round(box.top),
                  Math.round(box.width),
                  Math.round(box.height),
                ]
              : null,
            railInside:
              rail !== undefined &&
              rail.top >= 0 &&
              rail.bottom <= window.innerHeight &&
              box !== undefined &&
              rail.right <= box.right,
            pageScroll: document.documentElement.scrollHeight - window.innerHeight,
          };
        });
        await frameContext.close();
      }
      measured.frames = frames;
      const landscape = frames["740x360"];
      check(
        landscape.stage !== null &&
          Math.abs(landscape.stage[2] - (360 * 9) / 16) <= 1 &&
          landscape.stage[3] === 360 &&
          Math.abs(landscape.stage[0] - (740 - landscape.stage[2]) / 2) <= 1 &&
          landscape.railInside,
        `at 740x360 the player is not the uncropped 9:16 frame: ${JSON.stringify(landscape)}`,
      );
      check(
        Object.values(frames).every((frame) => frame.pageScroll <= 0),
        `the page scrolls outside the feed: ${JSON.stringify(frames)}`,
      );

      // A page scroll of 0 proves nothing about A11Y-05 on its own: without a
      // notch env(safe-area-inset-*) is 0, so putting the body padding back
      // would add 0 px and the check would stay green (R3B-02). Emulate a real
      // notch — top, bottom AND the landscape sides (R3B-03) — and measure
      // again: only then does a doubled inset push the 100dvh feed off-screen.
      //
      // The distance that matters is to the SCREEN edge, not to the picture: a
      // full-bleed portrait frame has to move its chrome in by the whole inset,
      // while a letterboxed landscape frame already stands 269 px clear and
      // must NOT pay it again — that squeezed the title column to 49 px.
      const notch = { top: 59, bottom: 34, left: 44, right: 44 };
      const readChrome = () => {
        const probe = document.createElement("div");
        probe.style.cssText =
          "position:fixed;top:env(safe-area-inset-top);left:env(safe-area-inset-left);right:env(safe-area-inset-right)";
        document.body.appendChild(probe);
        const style = getComputedStyle(probe);
        const seen = {
          top: parseFloat(style.top),
          left: parseFloat(style.left),
          right: parseFloat(style.right),
        };
        probe.remove();
        const body = getComputedStyle(document.body);
        const rail = document
          .querySelector('[data-active="true"] [role="toolbar"]')
          ?.getBoundingClientRect();
        // The overlay box spans the picture; its inset lives in the padding, so
        // what matters is where its text actually starts, and how much of it is
        // left to read.
        const title = document.querySelector('[data-active="true"] h2');
        const titleBox = title?.getBoundingClientRect();
        return {
          seen,
          bodyPadding: [body.paddingTop, body.paddingRight, body.paddingBottom, body.paddingLeft].join(
            " ",
          ),
          pageScroll: document.documentElement.scrollHeight - window.innerHeight,
          // Both measured from the screen, which is where the notch is.
          railClear: rail ? Math.round(window.innerWidth - rail.right) : null,
          titleClear: titleBox ? Math.round(titleBox.left) : null,
          titleColumn: title ? Math.round(title.clientWidth) : null,
          titleOverflow: title ? Math.round(title.scrollWidth - title.clientWidth) : null,
        };
      };
      const notched = {};
      for (const viewport of [
        { width: 375, height: 812 },
        { width: 812, height: 375 },
      ]) {
        for (const insets of [null, notch]) {
          const label = `${viewport.width}x${viewport.height}${insets ? " +notch" : ""}`;
          const context = await browser.newContext({
            viewport,
            isMobile: true,
            hasTouch: true,
          });
          await context.addInitScript(installPlayingProbe);
          const page = await context.newPage();
          trackPage(page, `notch ${label}`, consoleErrors, []);
          if (insets) {
            const cdp = await context.newCDPSession(page);
            await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
          }
          await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
          await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
            timeout: 10_000,
          });
          notched[label] = await page.evaluate(readChrome);
          await context.close();
        }
      }
      measured.safeAreaNotch = { notch, ...notched };
      const withNotch = [notched["375x812 +notch"], notched["812x375 +notch"]];
      check(
        withNotch.every(
          (frame) =>
            frame.seen.top === notch.top &&
            frame.seen.left === notch.left &&
            frame.seen.right === notch.right,
        ),
        `the emulated notch never reached env(safe-area-inset-*), so nothing below is proven: ${JSON.stringify(measured.safeAreaNotch)}`,
      );
      check(
        withNotch.every(
          (frame) => frame.bodyPadding === "0px 0px 0px 0px" && frame.pageScroll <= 0,
        ),
        `with a notch emulated the body pads the 100dvh feed: ${JSON.stringify(measured.safeAreaNotch)}`,
      );
      check(
        withNotch.every(
          (frame) =>
            frame.railClear !== null &&
            frame.railClear >= notch.right &&
            frame.titleClear !== null &&
            frame.titleClear >= notch.left,
        ),
        `the rail or the title block sits under the notch: ${JSON.stringify(measured.safeAreaNotch)}`,
      );
      check(
        notched["812x375 +notch"].titleColumn === notched["812x375"].titleColumn &&
          notched["812x375 +notch"].titleOverflow <= 0,
        `the letterboxed landscape frame pays the notch twice and loses its title column: ${JSON.stringify(measured.safeAreaNotch)}`,
      );
    }

    // 34: over a white frame the rail stays visible: each icon keeps 3:1
    // against the shaded picture behind it, also when pressed.
    {
      const brightContext = await browser.newContext({
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      });
      await brightContext.addInitScript(installPlayingProbe);
      const page = await brightContext.newPage();
      trackPage(page, "bright frame rail", consoleErrors, []);
      await page.goto(`${BASE}/watch/signal-night/episode-2`, {
        waitUntil: "domcontentloaded",
      });
      await page.addStyleTag({
        content: "video, img { filter: grayscale(1) brightness(40) !important; }",
      });
      await page.waitForFunction(() => window.__flowPlaying.length > 0, null, {
        timeout: 10_000,
      });
      await sleep(900);
      const measure = async () => {
        const out = {};
        for (const action of ["like", "follow", "share", "mute", "captions", "tune"]) {
          const button = page.locator(`[data-active="true"] [data-action="${action}"]`);
          const box = await button.boundingBox();
          if (!box) continue;
          const png = await page.screenshot({
            clip: {
              x: box.x + 7,
              y: box.y + 7,
              width: box.width - 14,
              height: box.height - 14,
            },
          });
          out[action] = iconContrast(png);
        }
        return out;
      };
      const idle = await measure();
      await page.click('[data-active="true"] [data-action="like"]');
      await page.click('[data-active="true"] [data-action="follow"]');
      await sleep(400);
      const pressed = await measure();
      measured.brightFrameRail = { idle, pressed };
      const all = [...Object.values(idle), ...Object.values(pressed)];
      check(
        Object.keys(idle).length === 6 && all.every((ratio) => ratio >= 3),
        `a rail icon fades into a white frame: ${JSON.stringify(measured.brightFrameRail)}`,
      );
      await brightContext.close();
    }
  }

  // 6: an unknown episode and any unknown URL: a real 404 with the product's
  // page, which offers one story to tap (UX-10).
  measured.notFound = {};
  for (const path of ["/watch/signal-night/does-not-exist", "/no-such-page"]) {
    const missing = await context.newPage();
    // The browser logs the 404 status itself; only script errors count here.
    missing.on("pageerror", (error) =>
      consoleErrors.push(`404 ${path}: ${error.message}`),
    );
    const response = await missing.goto(`${BASE}${path}`);
    const page404 = await missing.evaluate(() => {
      const story = document.querySelector("[data-not-found-story]");
      return {
        title: document.querySelector("h1")?.textContent ?? null,
        href: story?.getAttribute("href") ?? null,
        underline: story ? getComputedStyle(story).textDecorationLine : null,
        storyHeight: story ? Math.round(story.getBoundingClientRect().height) : null,
      };
    });
    measured.notFound[path] = { status: response ? response.status() : null, ...page404 };
    check(response?.status() === 404, `${path} answered ${response?.status()}`);
    check(
      page404.title === "This link has moved or expired." &&
        /^\/watch\/[a-z0-9-]+\/episode-\d+$/.test(page404.href ?? "") &&
        page404.underline === "none" &&
        (page404.storyHeight ?? 0) >= 44,
      `the 404 page for ${path} is not the product's page with a story: ${JSON.stringify(page404)}`,
    );
    await missing.close();
  }

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
