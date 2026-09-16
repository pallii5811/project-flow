import type { AnalyticsClient } from "@project-flow/analytics";

import type { ContentItem } from "../../feed/model/types";
import type { UserTasteProfile } from "../../recommendation/model/types";
import { aggregateEpisode, aggregateSeries } from "../aggregation/aggregate";
import {
  trackSceneMetadataLoaded,
  trackSceneQueryExecuted,
  trackSceneSignalUsed,
} from "../analytics/sceneGraphAnalytics";
import { createMockSceneGraphDocument } from "../fixtures/mockSceneGraph";
import { ingestSceneGraphDocument } from "../ingestion/ingestSceneGraph";
import type {
  EpisodeAggregation,
  SceneGraphDocument,
  SceneGraphSignals,
  SceneQuery,
  SceneResult,
  SeriesAggregation,
} from "../model/types";
import { getFollowingScene, queryScenes } from "../query/queryScenes";
import { computeSceneGraphSignals } from "../signals/sceneGraphSignals";
import {
  createMemorySceneGraphStore,
  createUnavailableSceneGraphStore,
  type SceneGraphStore,
} from "../storage/memorySceneGraphStore";

export type SceneGraphService = {
  ready(): Promise<boolean>;
  getDocument(): Promise<SceneGraphDocument | null>;
  query(query: SceneQuery): Promise<SceneResult[]>;
  aggregateEpisode(episodeId: string): Promise<EpisodeAggregation | null>;
  aggregateSeries(seriesId: string): Promise<SeriesAggregation | null>;
  getFollowingScene(sceneId: string): Promise<ReturnType<typeof getFollowingScene>>;
  /**
   * Optional ranking signals. Returns zeros when flag off / unavailable.
   * Must never throw into the feed path.
   */
  getSignalsForContent(
    item: ContentItem,
    profile: UserTasteProfile,
  ): Promise<SceneGraphSignals>;
};

export type CreateSceneGraphServiceOptions = {
  analytics: AnalyticsClient;
  store?: SceneGraphStore;
  /** When false, signals always return zeros. Default false (SCENE_GRAPH_SIGNALS_V0). */
  signalsEnabled?: boolean;
  /** When true, do not load fixtures (simulates unavailable). */
  unavailable?: boolean;
};

export async function createSceneGraphService(
  options: CreateSceneGraphServiceOptions,
): Promise<SceneGraphService> {
  const store =
    options.store ??
    (options.unavailable
      ? createUnavailableSceneGraphStore()
      : createMemorySceneGraphStore());

  if (!options.unavailable) {
    const existing = await store.load();
    if (!existing) {
      const ingested = ingestSceneGraphDocument(createMockSceneGraphDocument());
      if (ingested.ok) {
        await store.save(ingested.document);
        trackSceneMetadataLoaded(options.analytics, {
          scene_count: ingested.document.scenes.length,
          series_count: ingested.document.series.length,
          metadata_version: ingested.document.metadataVersion,
          schema_version: ingested.document.schemaVersion,
        });
      }
    }
  }

  const emptySignals: SceneGraphSignals = {
    genreMatch: 0,
    tropeMatch: 0,
    emotionalMatch: 0,
    narrativePatternMatch: 0,
    characterPatternMatch: 0,
  };

  return {
    async ready() {
      return store.isAvailable();
    },

    async getDocument() {
      return store.load();
    },

    async query(query) {
      const started = Date.now();
      const doc = await store.load();
      if (!doc) {
        trackSceneQueryExecuted(options.analytics, {
          query_type: summarizeQuery(query),
          result_count: 0,
          latency_ms: Date.now() - started,
          schema_version: 1,
        });
        return [];
      }
      const results = queryScenes(doc, query);
      trackSceneQueryExecuted(options.analytics, {
        query_type: summarizeQuery(query),
        result_count: results.length,
        latency_ms: Date.now() - started,
        schema_version: doc.schemaVersion,
      });
      return results;
    },

    async aggregateEpisode(episodeId) {
      const doc = await store.load();
      if (!doc) return null;
      return aggregateEpisode(doc, episodeId);
    },

    async aggregateSeries(seriesId) {
      const doc = await store.load();
      if (!doc) return null;
      return aggregateSeries(doc, seriesId);
    },

    async getFollowingScene(sceneId) {
      const doc = await store.load();
      if (!doc) return null;
      return getFollowingScene(doc, sceneId);
    },

    async getSignalsForContent(item, profile) {
      try {
        if (!options.signalsEnabled) return emptySignals;
        const doc = await store.load();
        const signals = computeSceneGraphSignals(doc, item, profile);
        const summary =
          signals.genreMatch +
          signals.tropeMatch +
          signals.emotionalMatch +
          signals.narrativePatternMatch +
          signals.characterPatternMatch;
        if (summary > 0) {
          trackSceneSignalUsed(options.analytics, {
            content_id: item.id,
            series_id: item.seriesId,
            signal_summary: Number(summary.toFixed(4)),
          });
        }
        return signals;
      } catch {
        return emptySignals;
      }
    },
  };
}

function summarizeQuery(query: SceneQuery): string {
  const keys = Object.keys(query).filter(
    (k) => query[k as keyof SceneQuery] !== undefined,
  );
  return keys.sort().join("+") || "empty";
}

/** Sync helper for tests — builds service with in-memory fixture. */
export async function createTestSceneGraphService(
  analytics: AnalyticsClient,
  overrides: Partial<CreateSceneGraphServiceOptions> = {},
): Promise<SceneGraphService> {
  return createSceneGraphService({
    analytics,
    signalsEnabled: false,
    ...overrides,
  });
}
