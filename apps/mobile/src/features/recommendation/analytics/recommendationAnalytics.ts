import type { AnalyticsClient } from "@project-flow/analytics";

import type { RecommendationCandidate } from "../model/types";

export function trackRecommendationImpression(
  analytics: AnalyticsClient,
  requestId: string,
  candidate: RecommendationCandidate,
  rankPosition: number,
): void {
  analytics.track("recommendation_impression", {
    recommendation_request_id: requestId,
    content_id: candidate.contentId,
    series_id: candidate.seriesId,
    recommendation_source: candidate.source,
    rank_position: rankPosition,
    score: Number(candidate.score.toFixed(4)),
    reason: candidate.reasons[0] ?? null,
  });
}

export function trackRecommendationPlayStarted(
  analytics: AnalyticsClient,
  requestId: string,
  candidate: RecommendationCandidate,
  rankPosition: number,
): void {
  analytics.track("recommendation_play_started", {
    recommendation_request_id: requestId,
    content_id: candidate.contentId,
    series_id: candidate.seriesId,
    recommendation_source: candidate.source,
    rank_position: rankPosition,
    score: Number(candidate.score.toFixed(4)),
  });
}

export function trackRecommendationCompleted(
  analytics: AnalyticsClient,
  requestId: string,
  candidate: RecommendationCandidate,
  rankPosition: number,
): void {
  analytics.track("recommendation_completed", {
    recommendation_request_id: requestId,
    content_id: candidate.contentId,
    series_id: candidate.seriesId,
    recommendation_source: candidate.source,
    rank_position: rankPosition,
    score: Number(candidate.score.toFixed(4)),
  });
}

export function trackRecommendationSkipped(
  analytics: AnalyticsClient,
  requestId: string,
  candidate: RecommendationCandidate,
  rankPosition: number,
  completionPercentage: number,
): void {
  analytics.track("recommendation_skipped", {
    recommendation_request_id: requestId,
    content_id: candidate.contentId,
    series_id: candidate.seriesId,
    recommendation_source: candidate.source,
    rank_position: rankPosition,
    score: Number(candidate.score.toFixed(4)),
    completion_percentage: completionPercentage,
  });
}
