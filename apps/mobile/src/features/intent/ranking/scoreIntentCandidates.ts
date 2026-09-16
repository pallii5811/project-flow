import type { ContentItem } from "../../feed/model/types";
import type { SceneGraphDocument } from "../../scene-graph/model/types";
import { queryScenes } from "../../scene-graph/query/queryScenes";
import { INTENT_MATCH_WEIGHTS } from "../mapping/intentToRecommendationBias";
import { intentToSceneQuery } from "../mapping/intentToSceneQuery";
import type { IntentCandidate, IntentModel } from "../model/types";

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let hits = 0;
  for (const value of a) {
    if (b.includes(value)) hits += 1;
  }
  return hits / Math.max(a.length, b.length);
}

/**
 * Deterministic intent score for a catalog item.
 * base editorial/popularity + intent match (+ optional scene graph boost).
 */
export function scoreItemForIntent(
  item: ContentItem,
  intent: IntentModel,
  sceneDoc: SceneGraphDocument | null,
): IntentCandidate {
  const matchedFields: string[] = [];
  let match = 0;

  const excludedContent = intent.exclusions?.contentIds ?? [];
  const excludedSeries = intent.exclusions?.seriesIds ?? [];
  if (excludedContent.includes(item.id) || excludedSeries.includes(item.seriesId)) {
    return {
      contentId: item.id,
      seriesId: item.seriesId,
      score: -Infinity,
      matchStrength: 0,
      matchedFields: [],
    };
  }

  if (intent.genres && intent.genres.length > 0) {
    const g = overlapScore(intent.genres, item.genres);
    if (g > 0) matchedFields.push("genres");
    match += INTENT_MATCH_WEIGHTS.genre * g;
  }
  if (intent.tropes && intent.tropes.length > 0) {
    const t = overlapScore(intent.tropes, item.tropes);
    if (t > 0) matchedFields.push("tropes");
    match += INTENT_MATCH_WEIGHTS.trope * t;
  }
  if (intent.similarityToSeriesId && item.seriesId === intent.similarityToSeriesId) {
    // Same series = strong for MORE_LIKE_THIS, but exclude current episode via exclusions
    match += INTENT_MATCH_WEIGHTS.similaritySeries;
    matchedFields.push("similaritySeries");
  } else if (intent.similarityToSeriesId) {
    // Related via shared genres from context
    const g = overlapScore(intent.genres ?? [], item.genres);
    match += INTENT_MATCH_WEIGHTS.similaritySeries * 0.4 * g;
  }
  if (intent.similarityToContentId && item.id === intent.similarityToContentId) {
    match -= 1; // never recommend the exact same item
  }
  if (intent.romanceIntensityMin !== undefined || intent.genres?.includes("romance")) {
    if (item.genres.includes("romance")) {
      match += INTENT_MATCH_WEIGHTS.romance;
      matchedFields.push("romance");
    }
  }
  if (intent.emotionalTone === "dark" || intent.suspenseIntensityMin !== undefined) {
    if (
      item.genres.includes("thriller") ||
      item.genres.includes("horror") ||
      item.tropes.includes("revenge") ||
      item.tropes.includes("betrayal")
    ) {
      match += INTENT_MATCH_WEIGHTS.suspense;
      matchedFields.push("darker");
    }
  }
  if (intent.preferProtagonist) {
    // Soft: prefer drama/romance stories that typically center a lead
    if (item.genres.includes("drama") || item.genres.includes("romance")) {
      match += 0.12;
      matchedFields.push("protagonist_soft");
    }
  }
  if (intent.surprise) {
    // Prefer lower popularity / different series — invert popularity soft
    match += INTENT_MATCH_WEIGHTS.surprise * (1 - item.popularityScore / 100);
    matchedFields.push("surprise");
  }

  let sceneBoost = 0;
  if (sceneDoc) {
    const { query } = intentToSceneQuery(intent);
    const hasFilters = Object.keys(query).length > 0;
    if (hasFilters) {
      const hits = queryScenes(sceneDoc, {
        ...query,
        seriesId: item.seriesId,
      });
      if (hits.length > 0) {
        sceneBoost = 0.25 * Math.min(1, hits[0]!.confidenceSummary.metadataConfidence);
        matchedFields.push("sceneGraph");
      }
    }
  }

  const base =
    (item.editorialPriority / 100) * 0.15 + (item.popularityScore / 100) * 0.1;
  const score =
    base + match * Math.max(0.2, intent.confidence) + sceneBoost;

  return {
    contentId: item.id,
    seriesId: item.seriesId,
    score,
    matchStrength: Math.max(0, Math.min(1, match + sceneBoost)),
    matchedFields,
  };
}

export function rankCatalogForIntent(
  catalog: ContentItem[],
  intent: IntentModel,
  sceneDoc: SceneGraphDocument | null,
): IntentCandidate[] {
  return catalog
    .map((item) => scoreItemForIntent(item, intent, sceneDoc))
    .filter((c) => Number.isFinite(c.score) && c.score > -Infinity)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.contentId.localeCompare(b.contentId);
    });
}
