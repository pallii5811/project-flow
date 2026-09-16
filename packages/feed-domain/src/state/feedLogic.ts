import type { ContentItem } from "../model/types";
import type { FeedSource } from "../source/deterministicFeedSource";
import { resolveNextInSeries } from "../continuation/resolveNextInSeries";

export type FeedWindow = {
  previous: ContentItem | null;
  current: ContentItem;
  next: ContentItem | null;
};

export function getFeedWindow(items: ContentItem[], index: number): FeedWindow {
  const current = items[index];
  if (!current) {
    throw new Error(`Feed index out of range: ${index}`);
  }
  return {
    previous: items[index - 1] ?? null,
    current,
    next: items[index + 1] ?? null,
  };
}

/** @deprecated Prefer resolveNextInSeries — kept for swipe adjacency helpers. */
export function resolveContinuation(
  source: FeedSource,
  items: ContentItem[],
  index: number,
): { nextIndex: number; continuedEpisode: boolean } {
  const resolution = resolveNextInSeries(source, items, index);
  if (resolution.kind === "next_in_series") {
    return { nextIndex: resolution.nextIndex, continuedEpisode: true };
  }
  return { nextIndex: index, continuedEpisode: false };
}

/** Prefetch set: previous, current, next only. */
export function getPrefetchIds(items: ContentItem[], index: number): Set<string> {
  const ids = new Set<string>();
  const window = getFeedWindow(items, Math.min(Math.max(index, 0), items.length - 1));
  ids.add(window.current.id);
  if (window.previous) ids.add(window.previous.id);
  if (window.next) ids.add(window.next.id);
  return ids;
}
