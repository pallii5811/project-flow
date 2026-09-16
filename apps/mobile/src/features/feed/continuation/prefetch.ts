import type { ContentItem } from "../model/types";
import type { FeedSource } from "../source/deterministicFeedSource";
import { getFeedWindow } from "../state/feedLogic";
import { resolveNextInSeries } from "../continuation/resolveNextInSeries";
import { NEAR_END_RATIO } from "../continuation/episodeBoundary";

/**
 * Prefetch priority for continuity:
 * 1) current 2) next-in-series (or feed next) 3) previous
 * When near end, always include next-in-series if it exists.
 */
export function getContinuationPrefetchIds(
  source: FeedSource,
  items: ContentItem[],
  index: number,
  progressRatio: number,
): Set<string> {
  const ids = new Set<string>();
  const window = getFeedWindow(items, Math.min(Math.max(index, 0), items.length - 1));
  ids.add(window.current.id);

  const resolution = resolveNextInSeries(source, items, index);
  if (resolution.kind === "next_in_series") {
    ids.add(resolution.next.id);
  } else if (window.next) {
    // Adjacent feed item for swipe only — not auto-continue target.
    ids.add(window.next.id);
  }

  if (window.previous) {
    ids.add(window.previous.id);
  }

  if (progressRatio >= NEAR_END_RATIO && resolution.kind === "next_in_series") {
    ids.add(resolution.next.id);
  }

  return ids;
}
