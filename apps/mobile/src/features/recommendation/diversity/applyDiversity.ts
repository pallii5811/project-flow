import type { ContentItem } from "../../feed/model/types";
import { MAX_CONSECUTIVE_SAME_SERIES } from "../model/weights";
import type { RecommendationCandidate } from "../model/types";

/**
 * Greedy diversity: avoid pathological same-series streaks,
 * but never demote continuation candidates.
 */
export function applyDiversity(
  ranked: RecommendationCandidate[],
  catalogById: Map<string, ContentItem>,
  enabled: boolean,
): RecommendationCandidate[] {
  if (!enabled || ranked.length <= 1) return ranked;

  const result: RecommendationCandidate[] = [];
  const deferred: RecommendationCandidate[] = [];
  let lastSeries: string | null = null;
  let streak = 0;

  for (const candidate of ranked) {
    if (candidate.source === "continuation") {
      result.push(candidate);
      lastSeries = candidate.seriesId;
      streak = 1;
      continue;
    }
    const item = catalogById.get(candidate.contentId);
    if (!item) continue;

    if (lastSeries === item.seriesId && streak >= MAX_CONSECUTIVE_SAME_SERIES) {
      deferred.push(candidate);
      continue;
    }

    result.push(candidate);
    if (lastSeries === item.seriesId) streak += 1;
    else {
      lastSeries = item.seriesId;
      streak = 1;
    }
  }

  // Append deferred while still preferring variety.
  for (const candidate of deferred) {
    result.push(candidate);
  }
  return result;
}
