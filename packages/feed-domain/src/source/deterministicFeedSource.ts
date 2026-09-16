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

  // Series → episode number → first item in feed order. Built once: looking
  // the next episode up must not walk the whole catalog at catalog scale.
  const episodes = new Map<string, Map<number, ContentItem>>();
  for (const item of byOrder) {
    let series = episodes.get(item.seriesId);
    if (!series) {
      series = new Map();
      episodes.set(item.seriesId, series);
    }
    if (!series.has(item.episodeNumber)) series.set(item.episodeNumber, item);
  }

  return {
    loadCatalog: () => catalog,
    getOrderedItems: () => byOrder,
    getNextEpisode(item: ContentItem): ContentItem | null {
      const next = episodes.get(item.seriesId)?.get(item.episodeNumber + 1);
      if (!next) return null;
      if (publishedOnly && !isPlayableItem(next, now)) return null;
      return next;
    },
  };
}
