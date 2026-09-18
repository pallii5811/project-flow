/* global window, document, performance, caches, navigator, getComputedStyle, KeyboardEvent, Event, HTMLVideoElement, Blob, Worker */
/**
 * The platform around the feed, in the real browser (docs/decisions.md,
 * batch 5). Run by scripts/e2e-feed.mjs after its own checks:
 *
 *  36. the export is served with the headers Cloudflare Pages will send
 *      (_headers): immutable where files never change, short where they do,
 *      nosniff and HSTS on every response, the document policies (CSP,
 *      frame and permissions) on pages, the 404 and the worker only;
 *  37. closed beta by default: noindex in the page and in the headers of
 *      every file, robots.txt lets crawlers read it (one kept out never
 *      would), no sitemap;
 *  38. the web app manifest is one Chrome accepts, with its icons, and the
 *      page asks for edge-to-edge (viewport-fit=cover) and dark bars;
 *  39. the service worker registers after the first episode plays, for the
 *      whole site, and takes over the page;
 *  40. its caches hold the offline shell and hashed static files only: no
 *      playlist, segment, poster, caption, catalog or page;
 *  41. offline, a page opens as the branded offline page at the address asked
 *      for, drawn with its own styles and fonts, and it comes back to the
 *      episode by itself when the network does;
 *  42. the policy allows a blob: worker as hls.js makes one, under both the
 *      header and the page's own meta policy, and it is enforced: an inline
 *      script that is not in the page as built does not run, and no site can
 *      frame the player;
 *  43. zero policy violations in the whole run (every context is watched);
 *  44. the install invitation: never in the first minute, then once, at the
 *      top (below an emulated notch), without taking focus, measured by
 *      honest events: Install, the iOS hint, "Not now", and never again for
 *      a visitor who was already shown it;
 *  45. an episode page carries its own title, og:title, og:type video.episode
 *      and site name, and a share points at the configured site
 *      (--site=https://… when the export was built with NEXT_PUBLIC_SITE_URL),
 *      never at the host that served the page.
 *
 * Also runs on its own, against the export as it is (about 2 minutes):
 *
 *   npm run build:web && npm run e2e:web:platform
 *   node scripts/e2e-platform.mjs --export=<dir> --skip-install
 *
 * --skip-install leaves out check 44, which needs a full minute of viewing.
 */
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** What Chrome writes to the console for each violation, and what our probe writes. */
const CSP_MESSAGE = /Content Security Policy|\[csp\]/i;

function installCspProbe() {
  document.addEventListener("securitypolicyviolation", (event) => {
    console.error(`[csp] ${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
  });
}

/**
 * Every context the run creates from here on reports its policy violations.
 * Returns the unwatched newContext, for the checks that break the policy on
 * purpose.
 */
export function watchContentSecurity(browser, violations) {
  const original = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await original(options);
    await context.addInitScript(installCspProbe);
    context.on("console", (message) => {
      if (CSP_MESSAGE.test(message.text())) violations.push(message.text().slice(0, 300));
    });
    return context;
  };
  return original;
}

function brandName(repoRoot) {
  const source = readFileSync(resolve(repoRoot, "apps/web/src/lib/brand.ts"), "utf8");
  return /export const BRAND_NAME = "([^"]+)";/.exec(source)?.[1] ?? null;
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString("latin1", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const PHONE = {
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
};
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "public, max-age=0, must-revalidate";

/** Media, catalog and pages: never in a worker cache. */
const NEVER_CACHED = /\/content\/|\/catalog\/|\/watch\/|\.m3u8|\.m4s|\.mp4|\.webp|\.jpe?g|\.vtt/;

function waitForFirstPlaying(page, timeout = 15_000) {
  return page.waitForFunction(() => window.__flowPlaying?.length > 0, null, { timeout });
}

/**
 * Taps a button of the episode on screen where a finger would: at its centre,
 * once it has held still for a few frames, with no scroll before. Playwright's
 * own click scrolls its target into view first, and inside the scroll-snap
 * feed that scroll can land on the next episode: measured 1 run in 12 on check
 * 45, when the rail was re-rendered as the catalog arrived, the click retried
 * with a scroll ("element is outside of the viewport") and the feed moved to
 * episode 3 before the tap. The app itself scrolled nothing (scrollIntoView,
 * scrollTo, scrollBy and focus traced: no call).
 */
async function tapActiveRailButton(page, label) {
  const handle = await page.waitForFunction(
    (name) => {
      const button = document.querySelector(`[data-active="true"] [aria-label="${name}"]`);
      const rect = button?.getBoundingClientRect();
      const inView = rect && rect.width > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
      const at = inView ? `${Math.round(rect.left)},${Math.round(rect.top)}` : null;
      const probe = (window.__flowTapProbe ??= { at: null, frames: 0 });
      probe.frames = at !== null && at === probe.at ? probe.frames + 1 : 0;
      probe.at = at;
      return probe.frames >= 3 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    },
    label,
    { timeout: 10_000, polling: "raf" },
  );
  const { x, y } = await handle.jsonValue();
  await page.evaluate(() => {
    window.__flowTapProbe = undefined;
  });
  await page.mouse.click(x, y);
}

/** Moves the active episode to its last half second, so it ends now. */
function finishActiveEpisode() {
  const video = document.querySelector('[data-active="true"] video');
  if (!(video instanceof HTMLVideoElement) || !Number.isFinite(video.duration)) return false;
  video.currentTime = Math.max(0, video.duration - 0.4);
  return true;
}

const activeId = () =>
  document.querySelector('[data-active="true"]')?.getAttribute("data-content-id") ?? null;

async function finishEpisodes(page, count) {
  for (let done = 0; done < count; done += 1) {
    const before = await page.evaluate(activeId);
    await page.waitForFunction(
      () => {
        const video = document.querySelector('[data-active="true"] video');
        return video instanceof HTMLVideoElement && Number.isFinite(video.duration) && !video.paused;
      },
      null,
      { timeout: 15_000 },
    );
    await page.evaluate(finishActiveEpisode);
    // The next episode of the series starts by itself (auto-continue). A
    // "playing" event alone is not proof: the seek itself resumes the same
    // episode.
    await page.waitForFunction(
      (seen) => {
        const active = document.querySelector('[data-active="true"]');
        const id = active?.getAttribute("data-content-id") ?? null;
        return id !== seen && window.__flowPlaying.some((entry) => entry.contentId === id);
      },
      before,
      { timeout: 15_000 },
    );
  }
}

export async function platformChecks({
  browser,
  unwatchedNewContext,
  base,
  repoRoot,
  check,
  measured,
  sleep,
  installPlayingProbe,
  collectAnalytics,
  cspViolations,
  scale,
  firstPlayBudgetMs,
  screenshotDir,
  // The site the build was configured with (NEXT_PUBLIC_SITE_URL); a local
  // build configures none, and then shares use the page's own origin.
  expectedShareOrigin = base,
}) {
  const brand = brandName(repoRoot);
  check(brand !== null, "apps/web/src/lib/brand.ts declares no BRAND_NAME");

  // 36: headers, as served.
  const home = await fetch(`${base}/`);
  const homeHtml = await home.text();
  const feedJson = await (await fetch(`${base}/catalog/feed.json`)).json();
  const lead = feedJson.items[0];
  const masterUrl = new URL(lead.playback.reference, base);
  const masterText = await (await fetch(masterUrl)).text();
  const rungUrl = new URL(masterText.split("\n").find((line) => line.endsWith(".m3u8")), masterUrl);
  const rungText = await (await fetch(rungUrl)).text();
  const segmentUrl = new URL(rungText.split("\n").find((line) => line.endsWith(".m4s")), rungUrl);
  const initUrl = new URL(/URI="([^"]+)"/.exec(rungText)?.[1] ?? "init_0.mp4", rungUrl);
  const chunk = /src="(\/_next\/static\/chunks\/[^"]+\.js)"/.exec(homeHtml)?.[1];
  const css = /href="(\/_next\/static\/css\/[^"]+\.css)"/.exec(homeHtml)?.[1];
  const cssText = css ? await (await fetch(`${base}${css}`)).text() : "";
  const fontRef = /url\(([^)]+\.woff2)\)/.exec(cssText)?.[1]?.replace(/["']/g, "");
  const font = fontRef && css ? new URL(fontRef, `${base}${css}`).pathname : null;
  const caption = lead.captions?.find((track) => track.status === "ready")?.url;
  const expectations = [
    ["/", REVALIDATE],
    ["/watch/signal-night/episode-2", REVALIDATE],
    [chunk, IMMUTABLE],
    [css, IMMUTABLE],
    [font, IMMUTABLE],
    [masterUrl.pathname, IMMUTABLE],
    [rungUrl.pathname, IMMUTABLE],
    [segmentUrl.pathname, IMMUTABLE],
    [initUrl.pathname, IMMUTABLE],
    [lead.playback.posterReference.split("?")[0], "public, max-age=300, stale-while-revalidate=86400"],
    [caption, "public, max-age=300"],
    ["/catalog/feed.json", "public, max-age=60"],
    ["/sw.js", "no-cache"],
  ];
  const DOCUMENTS = new Set(["/", "/watch/signal-night/episode-2", "/sw.js"]);
  measured.headersServed = {};
  // Read by check 37: the noindex must reach every file, not only the pages.
  const withoutNoindex = [];
  for (const [path, expected] of expectations) {
    if (!path) {
      check(false, `headers: no URL found for an expectation of "${expected}"`);
      continue;
    }
    const response = await fetch(`${base}${path}`, { method: "HEAD" });
    const headers = Object.fromEntries(response.headers);
    measured.headersServed[path] = headers["cache-control"];
    if (!/noindex/.test(headers["x-robots-tag"] ?? "")) withoutNoindex.push(path);
    check(response.ok, `headers: ${path} answered ${response.status}`);
    check(
      headers["cache-control"] === expected,
      `headers: ${path} Cache-Control "${headers["cache-control"]}", expected "${expected}"`,
    );
    check(
      headers["x-content-type-options"] === "nosniff" &&
        headers["referrer-policy"] === "strict-origin-when-cross-origin" &&
        /max-age=\d+/.test(headers["strict-transport-security"] ?? ""),
      `headers: ${path} lacks nosniff, Referrer-Policy or HSTS: ${JSON.stringify(headers)}`,
    );
    // Pages and the worker carry the document policies; every other file
    // leaves them out, since they would be bytes on each request for nothing.
    const csp = headers["content-security-policy"] ?? "";
    if (DOCUMENTS.has(path)) {
      check(
        /frame-ancestors 'none'/.test(csp) &&
          /worker-src[^;]*blob:/.test(csp) &&
          headers["x-frame-options"] === "DENY" &&
          /camera=\(\)/.test(headers["permissions-policy"] ?? ""),
        `headers: ${path} lacks a document security header: ${JSON.stringify(headers)}`,
      );
    } else {
      check(
        csp === "" && headers["permissions-policy"] === undefined,
        `headers: ${path} carries document-only headers: ${JSON.stringify(headers)}`,
      );
    }
  }
  // An unknown address is answered with the 404 page: a document, with its policies.
  {
    const missing = await fetch(`${base}/no-such-page`);
    measured.headersServed["/no-such-page"] = missing.status;
    check(
      missing.status === 404 && /frame-ancestors 'none'/.test(missing.headers.get("content-security-policy") ?? ""),
      `headers: the 404 page answered ${missing.status} without its policy`,
    );
  }
  const manifestResponse = await fetch(`${base}/manifest.webmanifest`);
  check(
    (manifestResponse.headers.get("content-type") ?? "").startsWith("application/manifest+json"),
    `the manifest is served as ${manifestResponse.headers.get("content-type")}`,
  );

  // 37: closed beta by default. The noindex is what keeps it out of search, so
  // robots.txt must let crawlers read it: a crawler kept out never sees it.
  const robots = await (await fetch(`${base}/robots.txt`)).text();
  const sitemap = await fetch(`${base}/sitemap.xml`);
  const starGroup = robots.split(/\n\s*\n/).find((group) => /^User-agent:\s*\*\s*$/im.test(group)) ?? "";
  measured.closedBeta = {
    metaRobots: /<meta name="robots" content="([^"]*)"/.exec(homeHtml)?.[1] ?? null,
    xRobotsTag: home.headers.get("x-robots-tag"),
    filesWithoutNoindex: withoutNoindex,
    robotsLetsCrawlersRead: /^Allow:\s*\/\s*$/im.test(starGroup) && !/^Disallow:\s*\/\s*$/im.test(starGroup),
    sitemapStatus: sitemap.status,
  };
  check(
    /noindex/.test(measured.closedBeta.metaRobots ?? "") &&
      /noindex/.test(measured.closedBeta.xRobotsTag ?? "") &&
      withoutNoindex.length === 0 &&
      measured.closedBeta.robotsLetsCrawlersRead &&
      !/^Sitemap:/im.test(robots) &&
      sitemap.status === 404,
    `the default export is not a closed beta: ${JSON.stringify(measured.closedBeta)}`,
  );

  // 38: installable.
  {
    const context = await browser.newContext(PHONE);
    await context.addInitScript(installPlayingProbe);
    const page = await context.newPage();
    await page.goto(`${base}/`, { waitUntil: "load" });
    const cdp = await context.newCDPSession(page);
    const appManifest = await cdp.send("Page.getAppManifest");
    const installability = await cdp.send("Page.getInstallabilityErrors").catch(() => null);
    const head = await page.evaluate(() => ({
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null,
      themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null,
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
      appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ?? null,
      title: document.title,
    }));
    const manifest = JSON.parse(appManifest.data ?? "null");
    const icons = [];
    for (const icon of manifest?.icons ?? []) {
      const response = await fetch(new URL(icon.src, base));
      const size = pngSize(Buffer.from(await response.arrayBuffer()));
      icons.push({ src: icon.src, sizes: icon.sizes, purpose: icon.purpose, real: size });
    }
    const installErrors = (installability?.installabilityErrors ?? [])
      .map((error) => error.errorId)
      // Playwright's contexts are incognito profiles; Chrome says so, and it
      // says nothing about the site.
      .filter((id) => id !== "in-incognito");
    measured.manifest = {
      parseErrors: appManifest.errors,
      installErrors,
      head,
      name: manifest?.name,
      display: manifest?.display,
      startUrl: manifest?.start_url,
      icons,
    };
    check(appManifest.errors.length === 0, `Chrome refuses the manifest: ${JSON.stringify(appManifest.errors)}`);
    check(installErrors.length === 0, `Chrome would not install the site: ${installErrors.join(", ")}`);
    check(
      manifest?.name === brand && manifest?.short_name === brand && manifest?.display === "standalone",
      `manifest: ${JSON.stringify({ name: manifest?.name, display: manifest?.display })}`,
    );
    check(
      /[?&]utm_source=homescreen/.test(manifest?.start_url ?? ""),
      `manifest start_url carries no source marker: ${manifest?.start_url}`,
    );
    for (const [sizes, purpose] of [
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ]) {
      const icon = icons.find((entry) => entry.sizes === sizes && entry.purpose === purpose);
      const [width, height] = sizes.split("x").map(Number);
      check(
        icon?.real?.width === width && icon?.real?.height === height,
        `manifest icon ${sizes} ${purpose}: ${JSON.stringify(icon ?? null)}`,
      );
    }
    check(
      head.manifest !== null &&
        head.themeColor === "#0b0b0c" &&
        /viewport-fit=cover/.test(head.viewport ?? "") &&
        head.appleIcon !== null &&
        head.title === brand,
      `page head: ${JSON.stringify(head)}`,
    );
    await context.close();
  }

  // 39–41: the service worker, its caches, and the offline page.
  {
    const context = await browser.newContext(PHONE);
    await context.addInitScript(installPlayingProbe);
    const page = await context.newPage();
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await waitForFirstPlaying(page);
    const firstPlayingAt = await page.evaluate(() => window.__flowPlaying[0].at);
    const registration = await page.evaluate(async () => {
      const deadline = performance.now() + 20_000;
      while (performance.now() < deadline) {
        const found = await navigator.serviceWorker.getRegistration();
        if (found) {
          const seenAt = performance.now();
          await navigator.serviceWorker.ready;
          while (!navigator.serviceWorker.controller && performance.now() < deadline) {
            await new Promise((done) => setTimeout(done, 100));
          }
          return {
            seenAt: Math.round(seenAt),
            scope: found.scope,
            script: (found.active ?? found.waiting ?? found.installing)?.scriptURL ?? null,
            controlled: navigator.serviceWorker.controller !== null,
          };
        }
        await new Promise((done) => setTimeout(done, 100));
      }
      return null;
    });
    measured.serviceWorker = { firstPlayingAt: Math.round(firstPlayingAt), ...registration };
    check(registration !== null, "the service worker never registered");
    check(
      registration === null || registration.seenAt > firstPlayingAt,
      `the service worker registered at ${registration?.seenAt} ms, before the first episode played (${Math.round(firstPlayingAt)} ms)`,
    );
    check(
      registration?.scope === `${base}/` && registration?.script === `${base}/sw.js`,
      `service worker scope ${registration?.scope}, script ${registration?.script}`,
    );
    check(registration?.controlled === true, "the service worker never took over the page");

    // Play on, swipe, let the catalog arrive: everything the feed fetches
    // passes by the worker.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" })));
    await page.waitForFunction(() => window.__flowPlaying.length > 1, null, { timeout: 10_000 });
    await sleep(2_500);

    // A returning open, with the worker and the caches warm.
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForFirstPlaying(page);
    measured.returningFirstPlayingMs = Math.round(await page.evaluate(() => window.__flowPlaying[0].at));
    check(
      measured.returningFirstPlayingMs <= firstPlayBudgetMs,
      `a returning open played after ${measured.returningFirstPlayingMs} ms (budget ${firstPlayBudgetMs} ms)`,
    );
    await sleep(1_500);

    const cached = await page.evaluate(async () => {
      const out = {};
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        out[name] = (await cache.keys()).map((request) => new URL(request.url).pathname);
      }
      return out;
    });
    const names = Object.keys(cached);
    const all = Object.values(cached).flat();
    const forbidden = all.filter((path) => NEVER_CACHED.test(path) || path === "/");
    measured.serviceWorkerCaches = Object.fromEntries(
      Object.entries(cached).map(([name, paths]) => [name, paths.length]),
    );
    check(
      names.length === 2 && names.every((name) => name.startsWith("flow-")),
      `worker caches: ${names.join(", ")}`,
    );
    check(forbidden.length === 0, `the worker cached media, catalog or pages: ${forbidden.slice(0, 6).join(", ")}`);
    check(all.includes("/offline-shell"), "the offline shell is not in the worker cache");
    check(
      all.some((path) => /^\/_next\/static\/chunks\/.+\.js$/.test(path)),
      "no hashed script was kept by the worker",
    );

    // 41: offline.
    const offlineErrors = [];
    page.on("pageerror", (error) => offlineErrors.push(error.message));
    await context.setOffline(true);
    const target = `${base}/watch/signal-night/episode-3`;
    const offlineResponse = await page.goto(target, { waitUntil: "load" }).catch(() => null);
    await sleep(300);
    const offline = await page.evaluate(() => {
      const root = document.querySelector("[data-offline-page]");
      const title = document.querySelector("h1");
      const retry = document.querySelector("[data-offline-retry]");
      return {
        shown: root !== null,
        url: window.location.href,
        title: document.title,
        heading: title?.textContent ?? null,
        brand: document.querySelector("main p")?.textContent ?? null,
        headingFont: title ? getComputedStyle(title).fontFamily : null,
        fontsLoaded: [...document.fonts].filter((face) => face.status === "loaded").length,
        background: root ? getComputedStyle(root).backgroundImage : null,
        retryHref: retry?.getAttribute("href") ?? null,
        scripts: [...document.scripts].map((script) => script.getAttribute("src")),
      };
    });
    measured.offlinePage = { status: offlineResponse?.status() ?? null, ...offline };
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/offline.png` }).catch(() => {});
    check(
      offline.shown && offline.url === target && offline.title === `Offline · ${brand}`,
      `offline, ${target} did not open the offline page at its own address: ${JSON.stringify(offline)}`,
    );
    check(
      offline.brand?.includes(brand ?? "(no brand)") === true &&
        /radial-gradient/.test(offline.background ?? "") &&
        offline.fontsLoaded > 0,
      `the offline page is drawn without its brand, styles or fonts: ${JSON.stringify(offline)}`,
    );
    check(
      offline.retryHref === target && offline.scripts.length === 1 && offline.scripts[0] === "/offline.js",
      `the offline page runs the app's scripts or cannot retry: ${JSON.stringify(offline)}`,
    );
    const backOnline = page.waitForURL(target, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await context.setOffline(false);
    await backOnline.catch(() => {});
    const returned = await page
      .waitForFunction(
        () =>
          window.__flowPlaying?.some((entry) => entry.contentId === "item_signal_3") === true,
        null,
        { timeout: 15_000 },
      )
      .then(() => true)
      .catch(() => false);
    measured.offlinePage.backOnlinePlays = returned;
    check(returned, "back online, the offline page did not come back to the episode");
    check(offlineErrors.length === 0, `offline page errors: ${offlineErrors.join(" | ")}`);
    await context.close();
  }

  // 42: the policy is enforced, not only declared.
  {
    const context = await unwatchedNewContext(PHONE);
    const page = await context.newPage();
    const refused = [];
    page.on("console", (message) => {
      if (CSP_MESSAGE.test(message.text())) refused.push(message.text().slice(0, 160));
    });
    await page.goto(`${base}/`, { waitUntil: "load" });
    // What hls.js does when it runs its transmuxer in a worker: a worker made
    // from a blob. Both policies apply, the header's and the page's own meta
    // policy, so each must allow it (hls.js/light as imported today never
    // does; the full build or workerPath would).
    const blobWorker = await page.evaluate(async () => {
      try {
        const url = URL.createObjectURL(new Blob(["postMessage('ready')"], { type: "text/javascript" }));
        const worker = new Worker(url);
        return await new Promise((done) => {
          worker.onmessage = (event) => done(event.data);
          worker.onerror = () => done("error");
          setTimeout(() => done("timeout"), 3_000);
        });
      } catch (error) {
        return `threw ${error.name}`;
      }
    });
    await sleep(200);
    const refusedByWorker = refused.length;
    const injected = await page.evaluate(async () => {
      const script = document.createElement("script");
      script.textContent = "window.__flowInjected = true;";
      document.head.appendChild(script);
      await new Promise((done) => setTimeout(done, 100));
      return window.__flowInjected === true;
    });
    const framer = await context.newPage();
    await framer.setContent(`<iframe src="${base}/" width="300" height="600"></iframe>`);
    await sleep(1_500);
    const frameUrl = framer.frames()[1]?.url() ?? null;
    const framedFeed = await framer.frames()[1]?.evaluate(() => document.querySelector('[role="feed"]') !== null).catch(() => false);
    measured.policyEnforced = { blobWorker, refusedByWorker, injectedRan: injected, refused: refused.length, frameUrl, framedFeed };
    check(
      blobWorker === "ready" && refusedByWorker === 0,
      `a blob: worker, as hls.js makes one, did not start: ${blobWorker}, ${refused.slice(0, refusedByWorker).join(" | ")}`,
    );
    check(!injected, "an inline script that is not in the page as built ran: the script policy is not enforced");
    check(refused.length > 0, "the injected script was not reported as a policy violation");
    check(framedFeed !== true, `another page framed the feed (frame at ${frameUrl})`);
    await context.close();
  }

  // 45: an episode page names itself, and a share points at the site (VIR-5, VIR-8).
  {
    const context = await browser.newContext(PHONE);
    await context.addInitScript(installPlayingProbe);
    await context.addInitScript(() => {
      window.__flowShared = [];
      Object.defineProperty(window.navigator, "share", {
        configurable: true,
        value: async (data) => {
          window.__flowShared.push(data);
        },
      });
    });
    const page = await context.newPage();
    await page.goto(`${base}/watch/signal-night/episode-2`, { waitUntil: "domcontentloaded" });
    await waitForFirstPlaying(page);
    const head = await page.evaluate(() => ({
      title: document.title,
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? null,
      ogType: document.querySelector('meta[property="og:type"]')?.getAttribute("content") ?? null,
      siteName: document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ?? null,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    }));
    await tapActiveRailButton(page, "Share");
    await page.waitForFunction(() => window.__flowShared.length > 0, null, { timeout: 5_000 }).catch(() => {});
    const shared = await page.evaluate(() => window.__flowShared[0] ?? null);
    await context.close();
    const sharedUrl = shared?.url ? new URL(shared.url) : null;
    measured.shareMetadata = { head, shared, expectedShareOrigin };
    check(
      head.title === `Signal Night · Episode 2 · ${brand}` &&
        head.ogTitle?.startsWith("Signal Night · Ep. 2") === true &&
        head.ogType === "video.episode" &&
        head.siteName === brand &&
        head.canonical?.endsWith("/watch/signal-night/episode-2") === true,
      `episode page metadata: ${JSON.stringify(head)}`,
    );
    check(
      sharedUrl?.origin === expectedShareOrigin && sharedUrl?.pathname === "/watch/signal-night/episode-2",
      `a share from ${base} points at ${shared?.url}, not at ${expectedShareOrigin}`,
    );
    check(
      shared?.title === "Signal Night · Episode 2" && shared?.text?.includes(`episode 2, on ${brand}`) === true,
      `the share text: ${JSON.stringify(shared)}`,
    );
  }

  // 44: the install invitation (normal catalog only: it needs a minute).
  // Four visitors in parallel, one minute in all: Install on a browser that
  // can install, the iOS hint on an iPhone with its notch, "Not now", and a
  // visitor who was already shown it once.
  if (!scale) {
    const run = async ({ label, platform, options = {}, answer, notch = null, alreadyOffered = false }) => {
      const context = await browser.newContext({ ...PHONE, ...options });
      await context.addInitScript(installPlayingProbe);
      if (alreadyOffered) {
        await context.addInitScript(() => {
          window.localStorage.setItem(
            "project-flow.install.v1",
            JSON.stringify({ offeredAt: Date.now() - 86_400_000, installed: false }),
          );
        });
      }
      const page = await context.newPage();
      if (notch) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: notch });
      }
      const events = collectAnalytics(page);
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await waitForFirstPlaying(page);
      if (platform === "prompt") {
        // Headless Chrome never offers to install; the page gets the event a
        // phone browser would send, with a prompt that records its use.
        await page.evaluate(() => {
          const event = new Event("beforeinstallprompt", { cancelable: true });
          event.prompt = async () => {
            window.__flowPrompted = true;
          };
          event.userChoice = Promise.resolve({ outcome: "accepted" });
          window.dispatchEvent(event);
        });
      }
      // Two episodes watched to the end in the first seconds: too early.
      await finishEpisodes(page, 2);
      await sleep(5_500);
      const early = await page.evaluate(() => document.querySelector("[data-install-offer]") !== null);
      // The viewer pauses (Space) until the first minute has passed, so the
      // series does not run out on its own; then plays on, and one more
      // episode ends: now it may appear.
      await page.keyboard.press("Space");
      const wait = 60_500 - (await page.evaluate(() => performance.now()));
      if (wait > 0) await sleep(wait);
      await page.keyboard.press("Space");
      const focusBefore = await page.evaluate(() => document.activeElement?.tagName ?? null);
      await finishEpisodes(page, 1);
      const shown = await page
        .waitForSelector("[data-install-offer]", { timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      await sleep(500);
      const layout = await page.evaluate(() => {
        const card = document.querySelector("[data-install-offer]");
        const box = card?.getBoundingClientRect();
        const rail = [...document.querySelectorAll('[data-active="true"] [role="toolbar"] button')]
          .map((button) => button.getBoundingClientRect())
          .filter((rect) => rect.width > 0);
        const overlapsRail = box
          ? rail.some(
              (rect) =>
                rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top,
            )
          : null;
        const title = card?.querySelector("p");
        const lineHeight = title ? parseFloat(getComputedStyle(title).lineHeight) : null;
        return {
          platform: card?.getAttribute("data-install-offer") ?? null,
          top: box ? Math.round(box.top) : null,
          bottom: box ? Math.round(box.bottom) : null,
          width: box ? Math.round(box.width) : null,
          titleLines: title && lineHeight ? Math.round(title.getBoundingClientRect().height / lineHeight) : null,
          overlapsRail,
          focus: document.activeElement?.tagName ?? null,
          text: card?.textContent ?? null,
        };
      });
      if (screenshotDir && shown) {
        await page.screenshot({ path: `${screenshotDir}/install-${label}.png` }).catch(() => {});
      }
      if (shown) await page.click(`[data-install-offer] button:has-text("${answer}")`);
      await sleep(600);
      const after = await page.evaluate(() => ({
        gone: document.querySelector("[data-install-offer]") === null,
        prompted: window.__flowPrompted === true,
        record: window.localStorage.getItem("project-flow.install.v1"),
      }));
      await context.close();
      const named = (name) => events.filter((event) => event.name === name).map((event) => event.properties);
      return {
        early,
        shown,
        layout,
        focusBefore,
        after,
        shownEvents: named("install_offer_shown"),
        answered: named("install_offer_answered"),
      };
    };
    const IPHONE_NOTCH = { top: 59, bottom: 34, left: 0, right: 0 };
    const [prompt, ios, notNow, again] = await Promise.all([
      run({ label: "prompt", platform: "prompt", answer: "Install" }),
      run({ label: "ios", platform: "ios", options: { userAgent: IPHONE_UA }, answer: "Got it", notch: IPHONE_NOTCH }),
      run({ label: "not-now", platform: "prompt", answer: "Not now" }),
      run({ label: "again", platform: "prompt", answer: "Install", alreadyOffered: true }),
    ]);
    measured.installOffer = { prompt, ios, notNow, again };
    for (const [label, result, platform, outcome, insetTop] of [
      ["prompt", prompt, "prompt", "accepted", 0],
      ["ios", ios, "ios", "acknowledged", IPHONE_NOTCH.top],
      ["not now", notNow, "prompt", "dismissed", 0],
    ]) {
      // The event says when it appeared: one probe at one instant could miss a
      // card that came and went (proven by a sabotage run that shows it at 5 s).
      check(
        !result.early && result.shownEvents.every((event) => event.visit_seconds >= 60),
        `install (${label}): the invitation appeared in the first minute: ${JSON.stringify(result.shownEvents)}`,
      );
      check(
        result.shown && result.layout.platform === platform,
        `install (${label}): not shown after a minute and three episodes: ${JSON.stringify(result.layout)}`,
      );
      check(
        result.layout.top !== null &&
          result.layout.top >= insetTop + 8 &&
          result.layout.top < insetTop + 40 &&
          result.layout.bottom - result.layout.top <= 140 &&
          result.layout.overlapsRail === false,
        `install (${label}): the card is not at the top, clear of the notch and the rail: ${JSON.stringify(result.layout)}`,
      );
      check(result.layout.titleLines === 1, `install (${label}): the title breaks onto ${result.layout.titleLines} lines`);
      check(result.layout.focus === result.focusBefore, `install (${label}): the card took focus (${result.layout.focus})`);
      check(result.layout.text?.includes(brand ?? "(no brand)") === true, `install (${label}): the card does not name ${brand}`);
      check(
        result.shownEvents.length === 1 && result.shownEvents[0]?.platform === platform,
        `install (${label}): install_offer_shown ${JSON.stringify(result.shownEvents)}`,
      );
      check(
        result.answered.length === 1 && result.answered[0]?.outcome === outcome,
        `install (${label}): install_offer_answered ${JSON.stringify(result.answered)}`,
      );
      check(
        result.after.gone && result.after.record?.includes('"offeredAt":') === true,
        `install (${label}): not closed for good: ${JSON.stringify(result.after)}`,
      );
    }
    check(prompt.after.prompted, "install (prompt): Install did not open the browser's own dialog");
    check(!notNow.after.prompted, "install (not now): Not now opened the browser's own dialog");
    check(
      !again.shown && again.shownEvents.length === 0 && again.answered.length === 0,
      `install (again): shown a second time to a visitor who already saw it: ${JSON.stringify(again.layout)}`,
    );
  }

  // 43: no policy violation anywhere in the run (checked by the caller last).
  measured.cspViolations = cspViolations;
}

/** `node scripts/e2e-platform.mjs`: the platform checks alone, on their own server. */
async function runAlone() {
  const { chromium } = await import("playwright-core");
  const { collectAnalytics, installPlayingProbe } = await import("./lib/e2e-probes.mjs");
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const exportArg = process.argv.find((arg) => arg.startsWith("--export="));
  const exportDir = exportArg ? resolve(exportArg.slice("--export=".length)) : "apps/web/out";
  const siteArg = process.argv.find((arg) => arg.startsWith("--site="));
  const port = 3219;
  const base = `http://localhost:${port}`;
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const failures = [];
  const measured = { mode: "platform" };
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const server = spawn(process.execPath, ["scripts/serve-static.mjs", exportDir, String(port)], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  let browser;
  try {
    for (let attempt = 0; ; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`static server exited with ${server.exitCode}`);
      const up = await fetch(`${base}/`).then((response) => response.ok).catch(() => false);
      if (up) break;
      if (attempt > 50) throw new Error(`static server did not start on ${base}`);
      await sleep(100);
    }
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const cspViolations = [];
    const unwatchedNewContext = watchContentSecurity(browser, cspViolations);
    await platformChecks({
      browser,
      unwatchedNewContext,
      base,
      repoRoot,
      check,
      measured,
      sleep,
      installPlayingProbe,
      collectAnalytics,
      cspViolations,
      // The same switch e2e-feed uses to leave out the minute-long check 44.
      scale: process.argv.includes("--skip-install"),
      firstPlayBudgetMs: 1_500,
      screenshotDir: process.env.FLOW_E2E_SCREENSHOTS ?? null,
      // --site=https://…: the export was built with that NEXT_PUBLIC_SITE_URL
      // (npm run export:web), so every share must point there, not here.
      expectedShareOrigin: siteArg ? new URL(siteArg.slice("--site=".length)).origin : base,
    });
    check(
      cspViolations.length === 0,
      `${cspViolations.length} content security policy violation(s): ${cspViolations.slice(0, 5).join(" | ")}`,
    );
  } catch (error) {
    failures.push(`run aborted: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await browser?.close();
    server.kill();
  }
  console.log(JSON.stringify(measured, null, 2));
  if (failures.length > 0) {
    console.error(`e2e-platform: FAILED\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
    process.exit(1);
  }
  console.error("e2e-platform: ok");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runAlone();
}
