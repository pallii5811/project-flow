import type { ContentItem } from "../../model/types";
import { averageAffinity, isColdStart } from "../profile/tasteProfile";
import { RANK_WEIGHTS } from "../model/weights";
import type {
  RecommendationCandidate,
  UserTasteProfile,
} from "../model/types";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normalizePopularity(score: number): number {
  return clamp(score / 100, 0, 1);
}

function normalizeEditorial(score: number): number {
  return clamp(score / 100, 0, 1);
}

/**
 * Deterministic affinity score for a content item.
 */
export function scoreCandidate(
  item: ContentItem,
  profile: UserTasteProfile,
  preferredLanguage: string,
  now = 0,
): number {
  if (isColdStart(profile)) {
    return (
      RANK_WEIGHTS.editorial * normalizeEditorial(item.editorialPriority) +
      RANK_WEIGHTS.popularity * normalizePopularity(item.popularityScore) +
      (item.language === preferredLanguage ? RANK_WEIGHTS.language : 0)
    );
  }

  const genre = averageAffinity(profile.likedGenres, item.genres);
  const trope = averageAffinity(profile.likedTropes, item.tropes);
  const series =
    (profile.likedSeries[item.seriesId] ?? 0) * 0.6 +
    (profile.completedSeries[item.seriesId] ?? 0) * 0.3 +
    (profile.watchedSeries[item.seriesId] ?? 0) * 0.1;
  const language =
    item.language === preferredLanguage
      ? Math.max(0.5, profile.languageAffinity[item.language] ?? 0.5)
      : (profile.languageAffinity[item.language] ?? 0) * 0.2;
  const recentBoost = profile.recentHistory.some(
    (h) =>
      h.seriesId === item.seriesId &&
      h.action !== "skip" &&
      now - h.timestamp < 24 * 60 * 60 * 1000,
  )
    ? 1
    : 0;
  const skipPenalty = profile.skippedSeries[item.seriesId] ?? 0;

  return (
    RANK_WEIGHTS.genre * tanh(genre) +
    RANK_WEIGHTS.trope * tanh(trope) +
    RANK_WEIGHTS.series * tanh(series) +
    RANK_WEIGHTS.language * clamp(language, 0, 1) +
    RANK_WEIGHTS.recent * recentBoost +
    RANK_WEIGHTS.completion * clamp(profile.completionAffinity, 0, 1) +
    RANK_WEIGHTS.editorial * normalizeEditorial(item.editorialPriority) +
    RANK_WEIGHTS.popularity * normalizePopularity(item.popularityScore) -
    RANK_WEIGHTS.skipPenalty * tanh(skipPenalty)
  );
}

function tanh(x: number): number {
  // Stable-ish unit squash without depending on Math.tanh edge cases for large |x|
  const e = Math.exp(-2 * Math.max(-20, Math.min(20, x)));
  return (1 - e) / (1 + e);
}

export function rankCandidates(
  candidates: RecommendationCandidate[],
  catalogById: Map<string, ContentItem>,
  profile: UserTasteProfile,
  preferredLanguage: string,
  now = 0,
): RecommendationCandidate[] {
  return candidates
    .map((c) => {
      const item = catalogById.get(c.contentId);
      if (!item) return { ...c, score: -Infinity };
      if (c.source === "continuation") {
        return {
          ...c,
          score: 10_000 + scoreCandidate(item, profile, preferredLanguage, now),
        };
      }
      return {
        ...c,
        score: scoreCandidate(item, profile, preferredLanguage, now),
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable tie-breakers
      if (a.contentId < b.contentId) return -1;
      if (a.contentId > b.contentId) return 1;
      return 0;
    });
}
