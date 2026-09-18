/* global window, document, performance, HTMLVideoElement */
/**
 * What the browser runs share (scripts/e2e-feed.mjs, scripts/e2e-platform.mjs).
 */

/** Every "playing" event, with the episode it belongs to and when it happened. */
export function installPlayingProbe() {
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

/**
 * Analytics envelopes the page logs (the export has no collector, so the
 * console transport prints each one as "[analytics] <name>", envelope).
 */
export function collectAnalytics(page) {
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
