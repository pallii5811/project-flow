import type { IntentModel, IntentRecommendationBias } from "../model/types";

/** Explicit intent contribution weights — tunable, not ML. */
export const INTENT_MATCH_WEIGHTS = {
  genre: 0.35,
  trope: 0.3,
  tone: 0.15,
  similaritySeries: 0.25,
  similarityContent: 0.1,
  romance: 0.2,
  suspense: 0.2,
  surprise: 0.15,
  base: 0.55,
} as const;

/**
 * Intent → temporary Recommendation bias.
 * Does NOT mutate UserTasteProfile.
 */
export function intentToRecommendationBias(
  intent: IntentModel,
): IntentRecommendationBias {
  return {
    intentId: intent.intentId,
    genres: intent.genres ?? [],
    tropes: intent.tropes ?? [],
    ...(intent.emotionalTone ? { emotionalTone: intent.emotionalTone } : {}),
    romanceBoost: intent.romanceIntensityMin ?? (intent.genres?.includes("romance") ? 0.4 : 0),
    suspenseBoost:
      intent.suspenseIntensityMin ?? (intent.emotionalTone === "dark" ? 0.4 : 0),
    ...(intent.similarityToContentId
      ? { similarityContentId: intent.similarityToContentId }
      : {}),
    ...(intent.similarityToSeriesId
      ? { similaritySeriesId: intent.similarityToSeriesId }
      : {}),
    surprise: Boolean(intent.surprise),
    preferProtagonist: Boolean(intent.preferProtagonist),
    weight: INTENT_MATCH_WEIGHTS.base * Math.max(0.2, intent.confidence),
  };
}
