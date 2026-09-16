import type { SceneQuery } from "../../scene-graph/model/types";
import type { IntentModel } from "../model/types";

/**
 * Map Intent → SceneQuery using only fields Scene Graph V0 can represent.
 * Unrepresentable dimensions stay on intent.unresolvedTerms.
 */
export function intentToSceneQuery(intent: IntentModel): {
  query: SceneQuery;
  unresolvedDimensions: string[];
} {
  const unresolvedDimensions: string[] = [...intent.unresolvedTerms];
  const query: SceneQuery = {};

  if (intent.genres && intent.genres.length > 0) {
    query.genres = intent.genres;
  }
  if (intent.tropes && intent.tropes.length > 0) {
    query.tropes = intent.tropes;
  }
  if (intent.emotionalTone) {
    query.emotionalTone = intent.emotionalTone;
  }
  if (intent.romanceIntensityMin !== undefined) {
    query.minRomanceIntensity = intent.romanceIntensityMin;
  }
  if (intent.suspenseIntensityMin !== undefined) {
    query.minSuspenseIntensity = intent.suspenseIntensityMin;
  }
  if (intent.cliffhangerStrengthMin !== undefined) {
    query.minCliffhangerStrength = intent.cliffhangerStrengthMin;
  }
  if (intent.emotionalIntensityDelta !== undefined) {
    query.minEmotionalIntensity = Math.min(
      1,
      0.4 + intent.emotionalIntensityDelta,
    );
  }
  if (intent.preferProtagonist) {
    query.characterRoles = ["protagonist"];
  }
  if (intent.preferFemaleLead) {
    // No sex/gender on Scene Graph V0 — degrade gracefully
    unresolvedDimensions.push("female_lead_not_in_scene_graph");
  }
  if (intent.similarityToSeriesId) {
    // Soft: do not hard-filter to same series (would break "more like this" discovery)
  }
  if (intent.surprise) {
    // Surprise uses low-confidence / exploration at ranking time, not a scene filter
  }

  return {
    query,
    unresolvedDimensions: [...new Set(unresolvedDimensions)],
  };
}
