import type { AnalyticsClient } from "@project-flow/analytics";

import type { ContentItem } from "../../feed/model/types";
import type { SceneGraphDocument } from "../../scene-graph/model/types";
import {
  trackIntentCandidateGenerated,
  trackIntentChipSelected,
  trackIntentParsed,
  trackIntentResolution,
  trackIntentTextSubmitted,
} from "../analytics/intentAnalytics";
import { intentToRecommendationBias } from "../mapping/intentToRecommendationBias";
import { intentToSceneQuery } from "../mapping/intentToSceneQuery";
import type { IntentChipId } from "../model/taxonomy";
import type {
  IntentParseContext,
  IntentRecommendationBias,
  IntentResolution,
} from "../model/types";
import {
  createIntentParser,
  createNoopSemanticFallback,
  type IntentParser,
  type SemanticFallback,
} from "../parser/createIntentParser";
import { rankCatalogForIntent } from "../ranking/scoreIntentCandidates";

export type IntentService = {
  resolveChip(
    chipId: IntentChipId,
    context: IntentParseContext,
  ): Promise<IntentResolution>;
  resolveText(
    text: string,
    context: IntentParseContext,
  ): Promise<IntentResolution>;
  /** Active next-item bias — cleared after consumption or replacement. */
  getActiveBias(): IntentRecommendationBias | null;
  getActiveResolution(): IntentResolution | null;
  consumeNextItemBias(): IntentResolution | null;
  clear(): void;
};

export type CreateIntentServiceOptions = {
  analytics: AnalyticsClient;
  sessionId: string;
  catalog: ContentItem[];
  getSceneDocument?: () => Promise<SceneGraphDocument | null>;
  parser?: IntentParser;
  semanticFallback?: SemanticFallback;
  nlEnabled?: boolean;
  /** Simulated parser failure for tests. */
  parserUnavailable?: boolean;
  /**
   * Optional Demand Graph sink — fire-and-forget, must never block Intent.
   * Recommendation remains operational if this is absent/disabled.
   */
  onDemandSignal?: (resolution: IntentResolution) => void;
};

const WEAK_THRESHOLD = 0.25;
const RESOLVED_THRESHOLD = 0.35;

export function createIntentService(
  options: CreateIntentServiceOptions,
): IntentService {
  const parser =
    options.parser ??
    createIntentParser(options.semanticFallback ?? createNoopSemanticFallback());

  let active: IntentResolution | null = null;
  let bias: IntentRecommendationBias | null = null;

  async function resolveFromIntent(
    parseOk: boolean,
    intent: IntentResolution["intent"],
  ): Promise<IntentResolution> {
    const started = Date.now();
    trackIntentParsed(options.analytics, intent, options.sessionId);

    if (options.parserUnavailable || !parseOk) {
      const resolution: IntentResolution = {
        intentId: intent.intentId,
        status: "unresolved",
        intent,
        candidates: [],
        resultCount: 0,
        matchStrength: 0,
        latencyMs: Date.now() - started,
        unresolvedTerms: intent.unresolvedTerms.length
          ? intent.unresolvedTerms
          : ["parser_unavailable"],
      };
      emitResolution(resolution);
      try {
        options.onDemandSignal?.(resolution);
      } catch {
        // ignore
      }
      // Keep feed: do not set active bias
      return resolution;
    }

    let sceneDoc: SceneGraphDocument | null = null;
    try {
      sceneDoc = (await options.getSceneDocument?.()) ?? null;
    } catch {
      sceneDoc = null;
    }

    // Ensure SceneQuery mapping is exercised (demand signal side-effect only)
    intentToSceneQuery(intent);

    const ranked = rankCatalogForIntent(options.catalog, intent, sceneDoc);
    const top = ranked.slice(0, Math.min(8, ranked.length));
    const best = top[0];
    const matchStrength = best?.matchStrength ?? 0;
    const resultCount = top.filter((c) => c.matchStrength >= WEAK_THRESHOLD || intent.surprise).length;

    let status: IntentResolution["status"] = "unresolved";
    if (resultCount === 0 || !best || best.score <= 0) {
      status = "unresolved";
    } else if (matchStrength >= RESOLVED_THRESHOLD || (intent.surprise && top.length > 0)) {
      status = "resolved";
    } else {
      status = "weak_match";
    }

    const resolution: IntentResolution = {
      intentId: intent.intentId,
      status,
      intent,
      candidates: status === "unresolved" ? [] : top,
      resultCount: status === "unresolved" ? 0 : top.length,
      matchStrength,
      latencyMs: Date.now() - started,
      unresolvedTerms: intent.unresolvedTerms,
    };

    emitResolution(resolution);

    // Demand Graph hook — async, non-blocking, never throws into Intent.
    try {
      options.onDemandSignal?.(resolution);
    } catch {
      // ignore
    }

    if (status !== "unresolved" && top.length > 0) {
      active = resolution;
      bias = intentToRecommendationBias(intent);
      trackIntentCandidateGenerated(options.analytics, {
        intent_id: intent.intentId,
        session_id: options.sessionId,
        result_count: resolution.resultCount,
        match_strength: Number(matchStrength.toFixed(3)),
      });
    } else {
      // unresolved: retain feed, no active bias
      active = null;
      bias = null;
    }

    return resolution;
  }

  function emitResolution(resolution: IntentResolution): void {
    trackIntentResolution(options.analytics, {
      intent_id: resolution.intentId,
      session_id: options.sessionId,
      status: resolution.status,
      result_count: resolution.resultCount,
      match_strength: resolution.matchStrength,
      intent_type: resolution.intent.chipId ?? "nl",
      parser_source: resolution.intent.parserSource,
      confidence: resolution.intent.confidence,
    });
  }

  return {
    async resolveChip(chipId, context) {
      if (options.parserUnavailable) {
        const empty = parser.parseChip(chipId, context);
        return resolveFromIntent(false, empty.intent);
      }
      const parsed = parser.parseChip(chipId, context);
      trackIntentChipSelected(options.analytics, {
        intent_id: parsed.intent.intentId,
        session_id: options.sessionId,
        intent_type: chipId,
      });
      return resolveFromIntent(parsed.ok, parsed.intent);
    },

    async resolveText(text, context) {
      if (!options.nlEnabled) {
        const intentId = `intent_nl_disabled_${Date.now().toString(36)}`;
        return resolveFromIntent(false, {
          intentId,
          source: "natural_language",
          lifetime: "NEXT_ITEM",
          confidence: 0,
          unresolvedTerms: ["nl_disabled"],
          parserSource: "unresolved",
          language: context.language,
        });
      }
      trackIntentTextSubmitted(options.analytics, {
        intent_id: "pending",
        session_id: options.sessionId,
        input_length: text.length,
      });
      if (options.parserUnavailable) {
        return resolveFromIntent(false, {
          intentId: `intent_fail_${Date.now().toString(36)}`,
          source: "natural_language",
          lifetime: "NEXT_ITEM",
          confidence: 0,
          unresolvedTerms: ["parser_unavailable"],
          parserSource: "unresolved",
          language: context.language,
        });
      }
      const parsed = await parser.parse(text, context, {
        allowSemanticFallback: false,
      });
      return resolveFromIntent(parsed.ok, parsed.intent);
    },

    getActiveBias() {
      return bias;
    },

    getActiveResolution() {
      return active;
    },

    consumeNextItemBias() {
      const current = active;
      if (!current || current.intent.lifetime !== "NEXT_ITEM") {
        return current;
      }
      active = null;
      bias = null;
      return current;
    },

    clear() {
      active = null;
      bias = null;
    },
  };
}
