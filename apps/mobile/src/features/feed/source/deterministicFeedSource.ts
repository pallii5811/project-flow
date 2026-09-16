import type { ContentItem, FeedCatalog } from "../model/types";
import { parseCatalog } from "../model/validate";

export type FeedSource = {
  loadCatalog(): FeedCatalog;
  getOrderedItems(): ContentItem[];
  getNextEpisode(item: ContentItem): ContentItem | null;
};

/**
 * Deterministic editorial order: ascending `order`, with series continuity preserved
 * in the mock data itself (episodes adjacent). Reproducible for tests.
 */
export function createDeterministicFeedSource(rawCatalog: unknown): FeedSource {
  const catalog = parseCatalog(rawCatalog);
  const byOrder = [...catalog.items].sort((a, b) => a.order - b.order);

  return {
    loadCatalog: () => catalog,
    getOrderedItems: () => byOrder,
    getNextEpisode(item: ContentItem): ContentItem | null {
      const sameSeries = byOrder.filter((candidate) => candidate.seriesId === item.seriesId);
      const next = sameSeries.find(
        (candidate) => candidate.episodeNumber === item.episodeNumber + 1,
      );
      return next ?? null;
    },
  };
}
