/* global self, caches, fetch, Response, URL */
/*
 * The site's service worker. scripts/finish-export.mjs copies this file to
 * out/sw.js with the build's version and precache list written in, so every
 * deploy ships a new worker that takes over on its own.
 *
 * What it keeps, and nothing else:
 * - the offline shell (offline-shell.html, offline.js, their styles and
 *   fonts), precached at install;
 * - files under /_next/static/, which are named by their content and never
 *   change, the first time the page asks for them.
 *
 * What it never keeps: pages (every navigation asks the network first, so a
 * deploy is visible on the next open), video playlists and segments,
 * posters, share cards, captions, the catalog. Those requests are not even
 * answered here: the browser fetches them as if there were no worker.
 */
const VERSION = "__FLOW_SW_VERSION__";
const PRECACHE = ["__FLOW_SW_PRECACHE__"];
/**
 * Without ".html": Cloudflare Pages answers "/offline-shell.html" with a
 * redirect, and a redirected response cannot answer a navigation.
 */
const OFFLINE_URL = "/offline-shell";
const SHELL_CACHE = `flow-shell-${VERSION}`;
const STATIC_CACHE = `flow-static-${VERSION}`;
/** Old static files are dropped with their version; this bounds one version. */
const STATIC_LIMIT = 120;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith("flow-") && !keep.has(name)) await caches.delete(name);
      }
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

/** The network's answer to a page, or the offline shell when there is none. */
async function networkFirstPage(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
    if (!offline) return Response.error();
    // A copy, in case a host redirected it on the way into the cache.
    return offline.redirected
      ? new Response(await offline.blob(), { headers: offline.headers })
      : offline;
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - STATIC_LIMIT))) {
    await cache.delete(request);
  }
}

async function cacheFirstStatic(request) {
  // The shell's own styles and fonts sit in the shell cache: look in both.
  const hit =
    (await caches.match(request, { cacheName: STATIC_CACHE })) ??
    (await caches.match(request, { cacheName: SHELL_CACHE }));
  if (hit) return hit;
  const cache = await caches.open(STATIC_CACHE);
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(event));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }
  // The offline shell's own files, when the shell is on screen.
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches
        .match(url.pathname, { cacheName: SHELL_CACHE })
        .then((hit) => hit ?? fetch(request)),
    );
  }
  // Everything else — media, posters, captions, the catalog — is not ours.
});
