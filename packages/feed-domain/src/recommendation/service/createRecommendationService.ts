import type { AnalyticsClient } from "@project-flow/analytics";

import type { ContentItem } from "../../model/types";
import { resolveNextInSeries } from "../../continuation/resolveNextInSeries";
import type { FeedSource } from "../../source/deterministicFeedSource";
import { generateCandidates } from "../candidates/generateCandidates";
import { applyDiversity } from "../diversity/applyDiversity";
import { applyExploration } from "../exploration/applyExploration";
import type {
  RecommendationCandidate,
  RecommendationContext,
  RecommendationResult,
  UserTasteProfile,
} from "../model/types";
import {
  applySignal,
  createEmptyProfile,
  isColdStart,
  type ProfileSignalInput,
} from "../profile/tasteProfile";
import {
  createAsyncTasteStore,
  createMemoryTasteStore,
  type TasteProfileStore,
} from "../profile/tasteStore";
import { rankCandidates } from "../ranking/rankCandidates";

export type RecommendationService = {
  getOrderedItems(context: Omit<RecommendationContext, "requestId" | "generatedAt"> & {
    requestId?: string;
  }): Promise<RecommendationResult>;
  recordSignal(input: ProfileSignalInput): Promise<UserTasteProfile>;
  getProfile(): Promise<UserTasteProfile>;
  /** Force refresh buffer after meaningful behavior. */
  invalidate(): void;
};

export type CreateRecommendationServiceOptions = {
  catalog: ContentItem[];
  feedSource: FeedSource;
  analytics: AnalyticsClient;
  sessionId: string;
  store?: TasteProfileStore;
  diversityEnabled?: boolean;
  explorationEnabled?: boolean;
  /** When false, always return editorial order (fallback path). */
  enabled?: boolean;
};

function editorialFallback(
  catalog: ContentItem[],
  requestId: string,
  now: number,
): RecommendationResult {
  const items: RecommendationCandidate[] = [...catalog]
    .sort((a, b) => b.editorialPriority - a.editorialPriority || a.order - b.order)
    .map((item) => ({
      contentId: item.id,
      seriesId: item.seriesId,
      source: "editorial" as const,
      reasons: ["editorial" as const, "cold_start" as const],
      score: item.editorialPriority,
    }));
  return {
    requestId,
    items,
    coldStart: true,
    usedFallback: true,
    generatedAt: now,
  };
}

export function createRecommendationService(
  options: CreateRecommendationServiceOptions,
): RecommendationService {
  const store = options.store ?? createAsyncTasteStore();
  let cachedProfile: UserTasteProfile | null = null;
  let cachedResult: RecommendationResult | null = null;
  let signalSinceRefresh = 0;
  const catalogById = new Map(options.catalog.map((item) => [item.id, item]));

  async function ensureProfile(): Promise<UserTasteProfile> {
    if (cachedProfile) return cachedProfile;
    cachedProfile = await store.load();
    return cachedProfile;
  }

  return {
    invalidate() {
      cachedResult = null;
      signalSinceRefresh = 0;
    },

    async getProfile() {
      return ensureProfile();
    },

    async recordSignal(input) {
      const profile = await ensureProfile();
      const next = applySignal(profile, input);
      cachedProfile = next;
      signalSinceRefresh += 1;
      // Refresh buffer after a few meaningful signals.
      if (
        input.action === "complete" ||
        input.action === "like" ||
        input.action === "follow" ||
        input.action === "skip" ||
        signalSinceRefresh >= 3
      ) {
        cachedResult = null;
      }
      await store.save(next);
      return next;
    },

    async getOrderedItems(context) {
      const requestId =
        context.requestId ??
        `rec_${context.sessionId}_${context.seed}_${context.now}`;
      const now = context.now;

      analyticsTrackSafe(options.analytics, "recommendation_requested", {
        recommendation_request_id: requestId,
        session_id: context.sessionId,
      });

      if (options.enabled === false) {
        const fallback = editorialFallback(options.catalog, requestId, now);
        analyticsTrackSafe(options.analytics, "recommendation_generated", {
          recommendation_request_id: requestId,
          candidate_count: fallback.items.length,
          used_fallback: true,
        });
        return fallback;
      }

      // Reuse cache when buffer still healthy and little new behavior.
      if (
        cachedResult &&
        !cachedResult.usedFallback &&
        signalSinceRefresh < 3 &&
        cachedResult.items.length >= context.limit
      ) {
        return cachedResult;
      }

      try {
        const profile = await ensureProfile();
        const exclude = new Set(context.excludeContentIds);

        // Continuation candidate from Prompt D rules
        let continuationItemId: string | null = null;
        if (context.activeContentId) {
          const activeIndex = options.catalog.findIndex(
            (item) => item.id === context.activeContentId,
          );
          if (activeIndex >= 0) {
            const resolution = resolveNextInSeries(
              options.feedSource,
              options.catalog,
              activeIndex,
            );
            if (resolution.kind === "next_in_series") {
              continuationItemId = resolution.next.id;
            }
          }
        }

        const candidates = generateCandidates(options.catalog, profile, {
          language: context.language,
          excludeContentIds: exclude,
          activeSeriesId: context.activeSeriesId,
          continuationItemId,
        });

        let ranked = rankCandidates(
          candidates,
          catalogById,
          profile,
          context.language,
          now,
        );

        const diversityOn =
          context.diversityEnabled && (options.diversityEnabled ?? true);
        ranked = applyDiversity(ranked, catalogById, diversityOn);

        const explorationOn =
          context.explorationEnabled && (options.explorationEnabled ?? true);
        ranked = applyExploration(ranked, options.catalog, profile, {
          enabled: explorationOn && !isColdStart(profile),
          seed: context.seed,
        });

        // Language soft filter: prefer preferred language when alternatives exist
        const preferred = ranked.filter((c) => {
          const item = catalogById.get(c.contentId);
          return item?.language === context.language;
        });
        if (preferred.length >= Math.min(3, ranked.length)) {
          const rest = ranked.filter((c) => !preferred.includes(c));
          ranked = [...preferred, ...rest];
        }

        // Ensure continuation stays first if present
        ranked = preferContinuationFirst(ranked, continuationItemId);

        const limited = ranked.slice(0, context.limit);
        const result: RecommendationResult = {
          requestId,
          items: limited,
          coldStart: isColdStart(profile),
          usedFallback: false,
          generatedAt: now,
        };
        cachedResult = result;
        signalSinceRefresh = 0;

        analyticsTrackSafe(options.analytics, "recommendation_generated", {
          recommendation_request_id: requestId,
          candidate_count: result.items.length,
          cold_start: result.coldStart,
          used_fallback: false,
        });

        for (const [index, item] of result.items.entries()) {
          analyticsTrackSafe(options.analytics, "recommendation_source_selected", {
            recommendation_request_id: requestId,
            content_id: item.contentId,
            series_id: item.seriesId,
            recommendation_source: item.source,
            rank_position: index,
            score: Number(item.score.toFixed(4)),
            reason: item.reasons[0] ?? null,
          });
          if (item.source === "exploration") {
            analyticsTrackSafe(options.analytics, "recommendation_exploration_served", {
              recommendation_request_id: requestId,
              content_id: item.contentId,
              rank_position: index,
            });
          }
        }

        return result;
      } catch {
        const fallback = editorialFallback(options.catalog, requestId, now);
        analyticsTrackSafe(options.analytics, "recommendation_generated", {
          recommendation_request_id: requestId,
          candidate_count: fallback.items.length,
          used_fallback: true,
        });
        return fallback;
      }
    },
  };
}

function preferContinuationFirst(
  ranked: RecommendationCandidate[],
  continuationItemId: string | null,
): RecommendationCandidate[] {
  if (!continuationItemId) return ranked;
  const idx = ranked.findIndex((c) => c.contentId === continuationItemId);
  if (idx <= 0) return ranked;
  const copy = [...ranked];
  const [item] = copy.splice(idx, 1);
  if (!item) return ranked;
  copy.unshift({ ...item, source: "continuation", reasons: ["continuation"] });
  return copy;
}

function analyticsTrackSafe(
  analytics: AnalyticsClient,
  event: Parameters<AnalyticsClient["track"]>[0],
  properties: Record<string, string | number | boolean | null>,
): void {
  try {
    analytics.track(event, properties);
  } catch {
    // never break feed
  }
}

/** Test helper: memory-backed service. */
export function createTestRecommendationService(
  options: Omit<CreateRecommendationServiceOptions, "store"> & {
    profile?: UserTasteProfile;
  },
): RecommendationService {
  return createRecommendationService({
    ...options,
    store: createMemoryTasteStore(options.profile ?? createEmptyProfile()),
  });
}
