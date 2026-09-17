import type { ContentItem, FeedCatalog } from "@project-flow/feed-domain";
import { watchPathForItem } from "@project-flow/feed-domain";

export type ShareUrlOptions = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  shareId?: string;
};

/** Absolute share URL with attribution query params. */
export function buildShareUrl(
  catalog: FeedCatalog,
  item: ContentItem,
  origin: string,
  options: ShareUrlOptions = {},
): string | null {
  const path = watchPathForItem(catalog, item);
  if (!path) return null;
  const base = origin.replace(/\/$/, "");
  const url = new URL(`${base}${path}`);
  url.searchParams.set("utm_source", options.utmSource ?? "share");
  url.searchParams.set("utm_medium", options.utmMedium ?? "social");
  if (options.utmCampaign) {
    url.searchParams.set("utm_campaign", options.utmCampaign);
  }
  if (options.shareId) {
    url.searchParams.set("share_id", options.shareId);
  }
  return url.toString();
}

/**
 * How long a playback error stays on screen before the feed moves on (PB-5):
 * long enough to read one sentence, short enough not to feel stuck.
 */
export const ERROR_SKIP_DELAY_MS = 2_500;

/**
 * Connection failures skipped in a row, with no episode playing in between,
 * before the feed stops moving on by itself. A network that is "online" but
 * carries no data would otherwise run through the whole feed, one episode
 * every twenty seconds (the same outcome the offline rule avoids).
 */
export const CONNECTION_SKIP_LIMIT = 2;

/**
 * Why a failed episode waits on screen instead of skipping:
 * connection: several episodes in a row could not reach the network;
 * end: nothing is left after it in the catalog.
 */
export type FailureHold = "connection" | "end";

export type PlaybackFailure = {
  contentId: string;
  /** The network or the no-progress watchdog failed, not the episode itself. */
  connection: boolean;
  hold: FailureHold | null;
};

/** The hold for a new failure, before any skip is scheduled. */
export function failureHoldFor(connection: boolean, consecutiveConnectionSkips: number): FailureHold | null {
  return connection && consecutiveConnectionSkips >= CONNECTION_SKIP_LIMIT ? "connection" : null;
}

/** Every episode of the full catalog is already listed: the feed cannot grow. */
export function feedExhausted(catalogComplete: boolean, catalogSize: number, listed: number): boolean {
  return catalogComplete && listed >= catalogSize;
}

/**
 * Slide the scroller rests on once scrolling settled (PB-6), or null for an
 * empty feed. Read only when the gesture is over, never mid-swipe.
 */
export function settledIndex(scrollTop: number, slideHeight: number, count: number): number | null {
  if (count <= 0) return null;
  const height = slideHeight > 0 ? slideHeight : 1;
  const raw = Math.round(scrollTop / height);
  return Math.min(count - 1, Math.max(0, raw));
}

/** The scroller already rests on the target: scrolling to it would fight a gesture. */
export function isAtSlide(scrollTop: number, slideTop: number): boolean {
  return Math.abs(scrollTop - slideTop) <= 1;
}

export type FirstPlayStartMode = "autoplay" | "play_gate" | "resume";

/**
 * Separates the first plays the product started from those a tap started
 * (MP-2): the time-to-first-play target is judged on `autoplay` only, since a
 * gate tap includes the viewer's reaction time.
 */
export function firstPlayStartMode(input: {
  gateTapped: boolean;
  resumeLandingId: string | null;
  contentId: string;
}): FirstPlayStartMode {
  if (input.gateTapped) return "play_gate";
  if (input.resumeLandingId !== null && input.resumeLandingId === input.contentId) return "resume";
  return "autoplay";
}

/** Whether the PlayGate should show (autoplay blocked and not yet user-started). */
export function shouldShowPlayGate(
  autoplayBlocked: boolean,
  userStartedPlayback: boolean,
): boolean {
  return autoplayBlocked && !userStartedPlayback;
}
