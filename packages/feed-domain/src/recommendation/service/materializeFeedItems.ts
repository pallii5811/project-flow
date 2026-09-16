import type { ContentItem } from "../../model/types";
import type { RecommendationCandidate, RecommendationResult } from "../model/types";

/**
 * Map ranked candidates → ContentItems, then append any catalog items
 * missing from the result so continuation can always resolve next episode.
 */
export function materializeFeedItems(
  result: RecommendationResult,
  catalog: ContentItem[],
): { items: ContentItem[]; metaByContentId: Map<string, RecommendationCandidate> } {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const metaByContentId = new Map<string, RecommendationCandidate>();
  const items: ContentItem[] = [];
  const seen = new Set<string>();

  for (const candidate of result.items) {
    const item = byId.get(candidate.contentId);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    metaByContentId.set(item.id, candidate);
  }

  for (const item of catalog) {
    if (seen.has(item.id)) continue;
    if (item.status && item.status !== "published") continue;
    if (!item.videoUrl.trim() && !item.playback.reference.trim()) continue;
    seen.add(item.id);
    items.push(item);
  }

  return { items, metaByContentId };
}
