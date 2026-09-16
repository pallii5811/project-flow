import type { AnalyticsClient } from "@project-flow/analytics";

import type { ContentItem } from "../../feed/model/types";
import type { IntentModel, IntentResolution } from "../../intent/model/types";
import {
  applyTemporalDecay,
  computeConfidence,
  deriveGapKind,
  deriveLifecycleState,
  recomputeRates,
} from "../aggregate/deriveState";
import {
  trackDemandGapEvent,
  trackDemandPatternQueried,
  trackDemandSignalCreated,
  trackDemandSignalNormalized,
  trackProductionSignalGenerated,
} from "../analytics/demandAnalytics";
import { findClosestContent } from "../closest/findClosestContent";
import {
  DEFAULT_DEMAND_THRESHOLDS,
  type DemandThresholds,
} from "../model/thresholds";
import type {
  DemandPatternRecord,
  DemandQuery,
  DemandSignal,
  DemandSignalSource,
  ProductionSignal,
} from "../model/types";
import {
  buildCanonicalKey,
  emptyBehavioralEvidence,
  normalizeFromIntent,
  patternIdFromKey,
  patternsRelated,
} from "../normalize/normalizeDemand";
import { buildProductionSignal } from "../producer/buildProductionSignal";
import {
  createMemoryDemandStore,
  createUnavailableDemandStore,
  type DemandGraphStore,
} from "../storage/memoryDemandStore";

export type DemandIngestInput = {
  source: DemandSignalSource;
  intent: IntentModel;
  resultCount: number;
  matchStrength: number;
  anonymousIdHash: string;
  dedupeKey: string;
  contextContentId?: string;
  contextSeriesId?: string;
  country?: string;
  language?: string;
  relatedContentId?: string;
  now?: number;
};

export type DemandGraphService = {
  ready(): Promise<boolean>;
  /** Async ingest — never throws into caller path. */
  ingest(input: DemandIngestInput): Promise<DemandPatternRecord | null>;
  /** Map IntentResolution → demand signal(s). Deduped. */
  ingestFromIntentResolution(
    resolution: IntentResolution,
    opts: {
      anonymousIdHash: string;
      country?: string;
      language?: string;
    },
  ): Promise<DemandPatternRecord | null>;
  recordRelatedBehavior(input: {
    patternId?: string;
    contentId: string;
    kind: "impression" | "play" | "complete" | "skip" | "next" | "share" | "follow" | "return";
    watchTimeMs?: number;
    anonymousIdHash: string;
  }): Promise<void>;
  query(query?: DemandQuery): Promise<DemandPatternRecord[]>;
  getPattern(patternId: string): Promise<DemandPatternRecord | null>;
  listProductionSignals(): Promise<ProductionSignal[]>;
  promoteToProductionSignal(patternId: string): Promise<ProductionSignal | null>;
  /**
   * Mark SATISFIED only with post-release evidence inputs.
   * Does not auto-satisfy on catalog change alone.
   */
  markSatisfied(input: {
    patternId: string;
    contentIds: string[];
    impressions: number;
    plays: number;
    completions: number;
    shares?: number;
    follows?: number;
  }): Promise<DemandPatternRecord | null>;
  reaggregate(now?: number): Promise<void>;
};

export type CreateDemandGraphServiceOptions = {
  analytics: AnalyticsClient;
  catalog: ContentItem[];
  store?: DemandGraphStore;
  thresholds?: Partial<DemandThresholds>;
  enabled?: boolean;
  unavailable?: boolean;
};

function hashAnon(raw: string): string {
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `anon_${(h >>> 0).toString(36)}`;
}

export function createDemandGraphService(
  options: CreateDemandGraphServiceOptions,
): DemandGraphService {
  const thresholds: DemandThresholds = {
    ...DEFAULT_DEMAND_THRESHOLDS,
    ...options.thresholds,
  };
  const store =
    options.store ??
    (options.unavailable
      ? createUnavailableDemandStore()
      : createMemoryDemandStore());

  /** patternId → anonymousId → request count (anti-obsession). */
  const userRequestCounts = new Map<string, Map<string, number>>();

  async function upsertFromSignal(
    signal: DemandSignal,
  ): Promise<DemandPatternRecord | null> {
    const canonicalKey = buildCanonicalKey(signal.normalized, thresholds.keyVersion);
    const patternId = patternIdFromKey(canonicalKey);

    let pattern = await store.getPattern(patternId);
    const prevState = pattern?.state;

    if (!pattern) {
      pattern = {
        patternId,
        canonicalKey,
        keyVersion: thresholds.keyVersion,
        normalized: signal.normalized,
        state: "DISCOVERED",
        gapKind: signal.normalized.gapKindHint,
        confidenceLevel: "low",
        confidenceScore: 0,
        evidence: emptyBehavioralEvidence(),
        closestContent: findClosestContent(signal.normalized, options.catalog),
        segments: { byCountry: {}, byLanguage: {} },
        firstSeen: signal.timestamp,
        lastSeen: signal.timestamp,
        activityScore: 1,
        relatedPatternIds: [],
        satisfyingContentIds: [],
        postLaunch: null,
        signalIds: [],
      };
      trackDemandSignalNormalized(options.analytics, {
        demand_pattern_id: patternId,
        canonical_key: canonicalKey,
      });
    }

    // Per-user request capping
    let userMap = userRequestCounts.get(patternId);
    if (!userMap) {
      userMap = new Map();
      userRequestCounts.set(patternId, userMap);
    }
    const prevUserCount = userMap.get(signal.anonymousIdHash) ?? 0;
    const nextUserCount = prevUserCount + 1;
    userMap.set(signal.anonymousIdHash, nextUserCount);

    pattern.evidence.requestCount += 1;
    if (prevUserCount === 0) {
      pattern.evidence.uniqueUsers += 1;
    } else if (prevUserCount === 1) {
      pattern.evidence.repeatUsers += 1;
    }
    if (nextUserCount <= thresholds.maxRequestsPerUserCounted) {
      pattern.evidence.cappedRequestCount += 1;
    }

    pattern.lastSeen = signal.timestamp;
    pattern.activityScore =
      applyTemporalDecay(
        pattern.activityScore,
        pattern.lastSeen,
        signal.timestamp,
        thresholds.requestHalfLifeMs,
      ) + 1;

    if (signal.country) {
      pattern.segments.byCountry[signal.country] =
        (pattern.segments.byCountry[signal.country] ?? 0) + 1;
    }
    const lang = signal.language ?? signal.normalized.language;
    if (lang) {
      pattern.segments.byLanguage[lang] =
        (pattern.segments.byLanguage[lang] ?? 0) + 1;
    }

    // Related behavior from outcome sources
    if (signal.relatedContentId || signal.source.startsWith("intent_result")) {
      if (signal.source === "intent_result_played") {
        pattern.evidence.relatedContentImpressions += 1;
        pattern.evidence.relatedContentPlays += 1;
      } else if (signal.source === "intent_result_completed") {
        pattern.evidence.relatedContentCompletions += 1;
      } else if (signal.source === "intent_result_skipped") {
        pattern.evidence.relatedContentSkips += 1;
      }
    }

    pattern.gapKind = deriveGapKind(pattern, signal, thresholds);
    if (!pattern.closestContent) {
      pattern.closestContent = findClosestContent(
        signal.normalized,
        options.catalog,
      );
    }

    recomputeRates(pattern.evidence);
    const conf = computeConfidence(pattern.evidence, thresholds);
    pattern.confidenceLevel = conf.level;
    pattern.confidenceScore = conf.score;

    const nextState = deriveLifecycleState(pattern, thresholds);
    pattern.state = nextState;
    pattern.signalIds = [...pattern.signalIds, signal.id].slice(-200);

    // Related patterns (deterministic overlap)
    const all = await store.loadPatterns();
    pattern.relatedPatternIds = all
      .filter(
        (p) =>
          p.patternId !== patternId &&
          patternsRelated(p.normalized, pattern!.normalized),
      )
      .map((p) => p.patternId)
      .slice(0, 20);

    await store.savePattern(pattern);

    trackDemandSignalCreated(options.analytics, {
      demand_pattern_id: patternId,
      source: signal.source,
      result_count: signal.resultCount,
      match_strength: Number(signal.matchStrength.toFixed(3)),
      validation_state: pattern.state,
    });

    if (prevState !== pattern.state) {
      if (pattern.state === "POSSIBLE_GAP") {
        trackDemandGapEvent(options.analytics, "demand_gap_detected", {
          demand_pattern_id: patternId,
          validation_state: pattern.state,
          confidence_level: pattern.confidenceLevel,
        });
      } else if (pattern.state === "REPEATED_GAP") {
        trackDemandGapEvent(options.analytics, "demand_gap_repeated", {
          demand_pattern_id: patternId,
          validation_state: pattern.state,
          confidence_level: pattern.confidenceLevel,
        });
      } else if (pattern.state === "BEHAVIORALLY_VALIDATED") {
        trackDemandGapEvent(options.analytics, "demand_gap_validated", {
          demand_pattern_id: patternId,
          validation_state: pattern.state,
          confidence_level: pattern.confidenceLevel,
        });
      }
    }

    return pattern;
  }

  return {
    async ready() {
      if (options.enabled === false) return false;
      try {
        return await store.isAvailable();
      } catch {
        return false;
      }
    },

    async ingest(input) {
      if (options.enabled === false) return null;
      try {
        if (!(await store.isAvailable())) return null;
        if (await store.hasDedupeKey(input.dedupeKey)) return null;

        const normalized = normalizeFromIntent(input.intent);
        const signal: DemandSignal = {
          id: `ds_${input.dedupeKey}`,
          source: input.source,
          timestamp: input.now ?? Date.now(),
          ...(input.country ? { country: input.country } : {}),
          ...(input.language ? { language: input.language } : {}),
          normalized,
          unresolvedFields: normalized.unresolvedFields,
          ...(input.contextContentId
            ? { contextContentId: input.contextContentId }
            : {}),
          ...(input.contextSeriesId
            ? { contextSeriesId: input.contextSeriesId }
            : {}),
          resultCount: input.resultCount,
          matchStrength: input.matchStrength,
          anonymousIdHash: input.anonymousIdHash.startsWith("anon_")
            ? input.anonymousIdHash
            : hashAnon(input.anonymousIdHash),
          dedupeKey: input.dedupeKey,
          metadataVersion: 1,
          ...(input.relatedContentId
            ? { relatedContentId: input.relatedContentId }
            : {}),
        };

        await store.saveSignal(signal);
        return upsertFromSignal(signal);
      } catch {
        return null;
      }
    },

    async ingestFromIntentResolution(resolution, opts) {
      if (options.enabled === false) return null;

      let source: DemandSignalSource;
      if (resolution.status === "unresolved") source = "intent_unresolved";
      else if (resolution.status === "weak_match") source = "intent_weak_match";
      else source = "intent_resolved";

      // INTENT_GAP for parser failures; CONTENT_GAP candidate for weak/zero
      return this.ingest({
        source,
        intent: resolution.intent,
        resultCount: resolution.resultCount,
        matchStrength: resolution.matchStrength,
        anonymousIdHash: opts.anonymousIdHash,
        dedupeKey: `${opts.anonymousIdHash}:${resolution.intentId}:${source}`,
        ...(resolution.intent.similarityToContentId
          ? { contextContentId: resolution.intent.similarityToContentId }
          : {}),
        ...(resolution.intent.similarityToSeriesId
          ? { contextSeriesId: resolution.intent.similarityToSeriesId }
          : {}),
        ...(opts.country ? { country: opts.country } : {}),
        ...(opts.language
          ? { language: opts.language }
          : resolution.intent.language
            ? { language: resolution.intent.language }
            : {}),
        ...(resolution.candidates[0]
          ? { relatedContentId: resolution.candidates[0].contentId }
          : {}),
      });
    },

    async recordRelatedBehavior(input) {
      if (options.enabled === false) return;
      try {
        const patterns = await store.loadPatterns();
        const targets = input.patternId
          ? patterns.filter((p) => p.patternId === input.patternId)
          : patterns.filter((p) => p.closestContent?.contentId === input.contentId);

        for (const pattern of targets) {
          const e = pattern.evidence;
          switch (input.kind) {
            case "impression":
              e.relatedContentImpressions += 1;
              break;
            case "play":
              e.relatedContentPlays += 1;
              break;
            case "complete":
              e.relatedContentCompletions += 1;
              break;
            case "skip":
              e.relatedContentSkips += 1;
              break;
            case "next":
              e.relatedContentNextItem += 1;
              break;
            case "share":
              e.shares += 1;
              break;
            case "follow":
              e.follows += 1;
              break;
            case "return":
              e.returns += 1;
              break;
            default:
              break;
          }
          if (input.watchTimeMs) {
            e.relatedContentWatchTimeMs += input.watchTimeMs;
          }
          recomputeRates(e);
          const conf = computeConfidence(e, thresholds);
          pattern.confidenceLevel = conf.level;
          pattern.confidenceScore = conf.score;
          pattern.state = deriveLifecycleState(pattern, thresholds);
          await store.savePattern(pattern);
        }
      } catch {
        // fail safe
      }
    },

    async query(query = {}) {
      if (options.enabled === false) return [];
      try {
        let patterns = await store.loadPatterns();
        if (query.state) {
          patterns = patterns.filter((p) => p.state === query.state);
        }
        if (query.gapKind) {
          patterns = patterns.filter((p) => p.gapKind === query.gapKind);
        }
        if (query.language) {
          patterns = patterns.filter(
            (p) => (p.segments.byLanguage[query.language!] ?? 0) > 0,
          );
        }
        if (query.country) {
          patterns = patterns.filter(
            (p) => (p.segments.byCountry[query.country!] ?? 0) > 0,
          );
        }
        if (query.minConfidence) {
          const order = { low: 0, medium: 1, high: 2 };
          const min = order[query.minConfidence];
          patterns = patterns.filter((p) => order[p.confidenceLevel] >= min);
        }
        patterns.sort((a, b) => b.confidenceScore - a.confidenceScore);
        const limited = patterns.slice(0, query.limit ?? 50);
        trackDemandPatternQueried(options.analytics, {
          result_count: limited.length,
        });
        return limited;
      } catch {
        return [];
      }
    },

    async getPattern(patternId) {
      try {
        return await store.getPattern(patternId);
      } catch {
        return null;
      }
    },

    async listProductionSignals() {
      const patterns = await this.query({
        state: "BEHAVIORALLY_VALIDATED",
        gapKind: "CONTENT_GAP",
      });
      const also = await this.query({
        state: "PRODUCTION_SIGNAL",
        gapKind: "CONTENT_GAP",
      });
      const merged = [...patterns, ...also];
      const out: ProductionSignal[] = [];
      for (const p of merged) {
        const signal = buildProductionSignal(p);
        if (signal) out.push(signal);
      }
      return out;
    },

    async promoteToProductionSignal(patternId) {
      const pattern = await store.getPattern(patternId);
      if (!pattern) return null;
      if (pattern.state !== "BEHAVIORALLY_VALIDATED") return null;
      if (pattern.gapKind !== "CONTENT_GAP") return null;
      pattern.state = "PRODUCTION_SIGNAL";
      await store.savePattern(pattern);
      const signal = buildProductionSignal(pattern);
      if (signal) {
        trackProductionSignalGenerated(options.analytics, {
          demand_pattern_id: patternId,
          confidence_level: pattern.confidenceLevel,
        });
      }
      return signal;
    },

    async markSatisfied(input) {
      const pattern = await store.getPattern(input.patternId);
      if (!pattern) return null;
      // Require post-release evidence — not automatic on catalog add.
      if (input.plays < 1 || input.completions < 1) return null;
      pattern.satisfyingContentIds = [
        ...new Set([...pattern.satisfyingContentIds, ...input.contentIds]),
      ];
      pattern.postLaunch = {
        impressions: input.impressions,
        plays: input.plays,
        completions: input.completions,
        shares: input.shares ?? 0,
        follows: input.follows ?? 0,
      };
      pattern.state = "SATISFIED";
      await store.savePattern(pattern);
      trackDemandGapEvent(options.analytics, "demand_signal_satisfied", {
        demand_pattern_id: pattern.patternId,
        validation_state: pattern.state,
        confidence_level: pattern.confidenceLevel,
      });
      return pattern;
    },

    async reaggregate(now = Date.now()) {
      const patterns = await store.loadPatterns();
      for (const pattern of patterns) {
        pattern.activityScore = applyTemporalDecay(
          pattern.activityScore,
          pattern.lastSeen,
          now,
          thresholds.requestHalfLifeMs,
        );
        recomputeRates(pattern.evidence);
        const conf = computeConfidence(pattern.evidence, thresholds);
        pattern.confidenceLevel = conf.level;
        pattern.confidenceScore = conf.score;
        if (pattern.state !== "SATISFIED" && pattern.state !== "PRODUCTION_SIGNAL") {
          pattern.state = deriveLifecycleState(pattern, thresholds);
        }
        await store.savePattern(pattern);
      }
    },
  };
}

/** Test helper: hash session to anonymous id. */
export function hashAnonymousId(raw: string): string {
  return hashAnon(raw);
}
