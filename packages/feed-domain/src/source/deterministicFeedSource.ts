import type { ContentItem, FeedCatalog } from "../model/types";
import { parseCatalog, toPublishedCatalog } from "../model/validate";
import { isPlayableItem } from "../playback/isPlayable";

export type FeedSource = {
  loadCatalog(): FeedCatalog;
  getOrderedItems(): ContentItem[];
  getNextEpisode(item: ContentItem): ContentItem | null;
};

export type DeterministicFeedSourceOptions = {
  /** When true (default), only published playable items enter the feed. */
  publishedOnly?: boolean;
  now?: number;
};

/**
 * Deterministic editorial order: ascending `order`.
 * Launch path uses publishedOnly so draft/expired never reach the player.
 */
export function createDeterministicFeedSource(
  rawCatalog: unknown,
  options: DeterministicFeedSourceOptions = {},
): FeedSource {
  const publishedOnly = options.publishedOnly !== false;
  const now = options.now ?? Date.now();
  const parsed = parseCatalog(rawCatalog);
  const catalog = publishedOnly ? toPublishedCatalog(parsed, now) : parsed;
  const byOrder = [...catalog.items]
    .filter((item) => (publishedOnly ? isPlayableItem(item, now) : true))
    .sort((a, b) => a.order - b.order);

  return {
    loadCatalog: () => catalog,
    getOrderedItems: () => byOrder,
    getNextEpisode(item: ContentItem): ContentItem | null {
      const sameSeries = byOrder.filter((candidate) => candidate.seriesId === item.seriesId);
      const next = sameSeries.find(
        (candidate) => candidate.episodeNumber === item.episodeNumber + 1,
      );
      if (!next) return null;
      if (publishedOnly && !isPlayableItem(next, now)) return null;
      return next;
    },
  };
}
