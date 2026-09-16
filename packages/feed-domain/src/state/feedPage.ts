/**
 * The feed at catalog scale (docs/decisions.md, "Feed at scale").
 *
 * The feed list is a page of about 40 episodes, extended from the catalog
 * order when the viewer gets close to its end — never the whole catalog. Only
 * the slides around the one playing render poster and player; the rest are
 * empty placeholders that keep their scroll-snap point.
 */
import type { ContentItem } from "../model/types";
import type { FeedSource } from "../source/deterministicFeedSource";

export const FEED_PAGE_SIZE = 40;
/** Extend the page when the viewer is this close to its last episode. */
export const FEED_EXTEND_WITHIN = 10;
/** Slides in [index - radius, index + radius] render poster and player. */
export const FEED_RENDER_RADIUS = 2;

export function shouldRenderSlide(itemIndex: number, index: number): boolean {
  return Math.abs(itemIndex - index) <= FEED_RENDER_RADIUS;
}

export function needsExtension(length: number, index: number): boolean {
  return index >= length - FEED_EXTEND_WITHIN;
}

/** Appends the next episodes of the catalog order that are not listed yet. */
export function extendFeedPage(
  items: ContentItem[],
  order: ContentItem[],
  pageSize = FEED_PAGE_SIZE,
): ContentItem[] {
  const listed = new Set(items.map((item) => item.id));
  const added: ContentItem[] = [];
  for (const item of order) {
    if (added.length >= pageSize) break;
    if (listed.has(item.id)) continue;
    listed.add(item.id);
    added.push(item);
  }
  return added.length === 0 ? items : [...items, ...added];
}

/**
 * Applies a recommended order without touching what the viewer can already
 * see: the slides up to the next episode stay where they are (the next one is
 * already warming up), and the recommendation fills the page after them.
 */
export function applyRecommendedPage(
  items: ContentItem[],
  index: number,
  recommended: ContentItem[],
  pageSize = FEED_PAGE_SIZE,
): ContentItem[] {
  const kept = items.slice(0, Math.max(0, index + 2));
  const listed = new Set(kept.map((item) => item.id));
  const page = [...kept];
  for (const item of recommended) {
    if (page.length - kept.length >= pageSize) break;
    if (listed.has(item.id)) continue;
    listed.add(item.id);
    page.push(item);
  }
  return page;
}

export type PlacedNextEpisode =
  | { kind: "next_in_series"; items: ContentItem[]; nextIndex: number; next: ContentItem }
  | { kind: "series_complete" };

/**
 * Auto-continue within the series (Prompt D). When the next episode is in the
 * list, go there, as the feed always did. A page does not hold the whole
 * catalog, so when it is missing it is placed right after the current one.
 */
export function placeNextInSeries(
  source: FeedSource,
  items: ContentItem[],
  index: number,
): PlacedNextEpisode {
  const current = items[index];
  if (!current) return { kind: "series_complete" };
  const next = source.getNextEpisode(current);
  if (!next || (!next.videoUrl.trim() && !next.playback.reference.trim())) {
    return { kind: "series_complete" };
  }
  const found = items.findIndex((item) => item.id === next.id);
  if (found >= 0) return { kind: "next_in_series", items, nextIndex: found, next };
  const placed = [...items.slice(0, index + 1), next, ...items.slice(index + 1)];
  return { kind: "next_in_series", items: placed, nextIndex: index + 1, next };
}

/**
 * A page that starts at `item` (a resumed episode), followed by the next
 * episode of its series when there is one, then the episodes already listed.
 */
export function pageStartingAt(
  source: FeedSource,
  item: ContentItem,
  listed: ContentItem[],
): ContentItem[] {
  const next = source.getNextEpisode(item);
  const head = next ? [item, next] : [item];
  const headIds = new Set(head.map((entry) => entry.id));
  return [...head, ...listed.filter((entry) => !headIds.has(entry.id))];
}
