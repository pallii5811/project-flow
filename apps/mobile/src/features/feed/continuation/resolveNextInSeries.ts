import type { ContentItem } from "../model/types";
import type { FeedSource } from "../source/deterministicFeedSource";

export type NextEpisodeResolution =
  | {
      kind: "next_in_series";
      next: ContentItem;
      nextIndex: number;
    }
  | {
      kind: "series_complete";
      next: null;
      nextIndex: null;
    };

/**
 * Prompt D: only continue within the same series.
 * Never autoplay an unrelated series.
 */
export function resolveNextInSeries(
  source: FeedSource,
  items: ContentItem[],
  index: number,
): NextEpisodeResolution {
  const current = items[index];
  if (!current) {
    return { kind: "series_complete", next: null, nextIndex: null };
  }

  const next = source.getNextEpisode(current);
  if (!next || !next.videoUrl.trim()) {
    return { kind: "series_complete", next: null, nextIndex: null };
  }

  const nextIndex = items.findIndex((item) => item.id === next.id);
  if (nextIndex < 0) {
    return { kind: "series_complete", next: null, nextIndex: null };
  }

  return { kind: "next_in_series", next, nextIndex };
}
