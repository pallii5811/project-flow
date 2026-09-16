import type { ContentItem } from "../../feed/model/types";
import type { UserTasteProfile } from "../../recommendation/model/types";
import { averageAffinity } from "../../recommendation/profile/tasteProfile";
import type { SceneGraphDocument, SceneGraphSignals } from "../model/types";
import { aggregateSeries } from "../aggregation/aggregate";

/**
 * Optional Scene Graph signals for future ranking.
 * Recommendation V0 must work with these at zero / unused.
 * Never block playback — caller must gate on SCENE_GRAPH_SIGNALS_V0.
 */
export function computeSceneGraphSignals(
  doc: SceneGraphDocument | null,
  item: ContentItem,
  profile: UserTasteProfile,
): SceneGraphSignals {
  const empty: SceneGraphSignals = {
    genreMatch: 0,
    tropeMatch: 0,
    emotionalMatch: 0,
    narrativePatternMatch: 0,
    characterPatternMatch: 0,
  };
  if (!doc) return empty;

  const seriesAgg = aggregateSeries(doc, item.seriesId);
  if (!seriesAgg) return empty;

  const genreMatch = averageAffinity(
    profile.likedGenres,
    seriesAgg.dominantGenres,
  );
  const tropeMatch = averageAffinity(
    profile.likedTropes,
    seriesAgg.dominantTropes,
  );

  // Soft squash into 0–1-ish without claiming ML accuracy.
  const squash = (n: number) => Math.max(0, Math.min(1, n / 3));

  return {
    genreMatch: squash(genreMatch),
    tropeMatch: squash(tropeMatch),
    emotionalMatch: squash(
      seriesAgg.overallTone
        ? (profile.likedGenres[seriesAgg.overallTone] ?? 0) * 0.2
        : 0,
    ),
    narrativePatternMatch: squash(seriesAgg.maxCliffhangerStrength),
    characterPatternMatch: squash(
      seriesAgg.characterSet.reduce(
        (sum, id) => sum + (profile.likedSeries[id] ?? 0),
        0,
      ) / Math.max(1, seriesAgg.characterSet.length),
    ),
  };
}
