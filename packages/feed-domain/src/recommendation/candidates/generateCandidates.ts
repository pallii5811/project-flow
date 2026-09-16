import type { ContentItem } from "../../model/types";
import { averageAffinity, isColdStart } from "../profile/tasteProfile";
import type {
  RecommendationCandidate,
  RecommendationReason,
  RecommendationSource,
  UserTasteProfile,
} from "../model/types";

function candidate(
  item: ContentItem,
  source: RecommendationSource,
  reasons: RecommendationReason[],
  score = 0,
): RecommendationCandidate {
  return {
    contentId: item.id,
    seriesId: item.seriesId,
    source,
    reasons,
    score,
  };
}

function isAvailable(item: ContentItem): boolean {
  if (item.status && item.status !== "published") return false;
  return item.videoUrl.trim().length > 0 || item.playback.reference.trim().length > 0;
}

export function generateCandidates(
  catalog: ContentItem[],
  profile: UserTasteProfile,
  opts: {
    language: string;
    excludeContentIds: Set<string>;
    activeSeriesId: string | null;
    continuationItemId: string | null;
  },
): RecommendationCandidate[] {
  const available = catalog.filter(
    (item) => isAvailable(item) && !opts.excludeContentIds.has(item.id),
  );
  const byId = new Map(available.map((item) => [item.id, item]));
  const merged = new Map<string, RecommendationCandidate>();

  const upsert = (c: RecommendationCandidate) => {
    const existing = merged.get(c.contentId);
    if (!existing) {
      merged.set(c.contentId, c);
      return;
    }
    // Keep stronger primary source priority: continuation > affinity > editorial > popular > recent > exploration
    const priority: Record<RecommendationSource, number> = {
      continuation: 6,
      affinity: 5,
      editorial: 4,
      popular: 3,
      recent: 2,
      exploration: 1,
    };
    if (priority[c.source] > priority[existing.source]) {
      merged.set(c.contentId, {
        ...c,
        reasons: Array.from(new Set([...existing.reasons, ...c.reasons])),
      });
    } else {
      existing.reasons = Array.from(new Set([...existing.reasons, ...c.reasons]));
    }
  };

  // CONTINUATION — highest priority source tag when present
  if (opts.continuationItemId) {
    const item = byId.get(opts.continuationItemId);
    if (item) {
      upsert(candidate(item, "continuation", ["continuation"], 1000));
    }
  }

  // EDITORIAL
  for (const item of [...available].sort(
    (a, b) => b.editorialPriority - a.editorialPriority || a.order - b.order,
  )) {
    upsert(
      candidate(item, "editorial", [
        isColdStart(profile) ? "cold_start" : "editorial",
      ]),
    );
  }

  // POPULAR
  for (const item of [...available].sort(
    (a, b) => b.popularityScore - a.popularityScore || a.order - b.order,
  )) {
    upsert(candidate(item, "popular", ["popular"]));
  }

  // AFFINITY — items matching liked genres/series
  if (!isColdStart(profile)) {
    for (const item of available) {
      const genreScore = averageAffinity(profile.likedGenres, item.genres);
      const seriesScore = profile.likedSeries[item.seriesId] ?? 0;
      if (genreScore > 0.2 || seriesScore > 0.2) {
        const reasons: RecommendationReason[] = ["similar_taste"];
        if (genreScore > 0.2) reasons.push("completed_same_genre");
        if (seriesScore > 0.5) reasons.push("followed_series");
        if (item.language === opts.language) reasons.push("language_match");
        upsert(candidate(item, "affinity", reasons));
      }
    }
  }

  // RECENT — series from recent history (not skips)
  const recentSeries = new Set(
    profile.recentHistory
      .filter((h) => h.action !== "skip")
      .slice(0, 10)
      .map((h) => h.seriesId),
  );
  for (const item of available) {
    if (recentSeries.has(item.seriesId)) {
      upsert(candidate(item, "recent", ["recent_interest"]));
    }
  }

  return Array.from(merged.values());
}
