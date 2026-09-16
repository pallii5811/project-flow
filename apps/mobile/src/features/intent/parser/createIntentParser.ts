import type { EmotionalTone, SceneGenre, SceneTrope } from "../../scene-graph/model/taxonomy";
import { chipToIntent } from "../model/chipIntents";
import type { IntentChipId } from "../model/taxonomy";
import { INTENT_CHIP_IDS } from "../model/taxonomy";
import type { IntentModel, IntentParseContext, IntentParseResult } from "../model/types";

export type SemanticFallback = {
  parse(
    text: string,
    context: IntentParseContext,
  ): Promise<Partial<IntentModel> | null>;
};

/** Isolated LLM/semantic fallback — V0 stub returns null (no invented confidence). */
export function createNoopSemanticFallback(): SemanticFallback {
  return {
    async parse() {
      return null;
    },
  };
}

export type IntentParser = {
  parseChip(chipId: IntentChipId, context: IntentParseContext): IntentParseResult;
  parse(
    input: string,
    context: IntentParseContext,
    options?: { allowSemanticFallback?: boolean },
  ): Promise<IntentParseResult>;
};

function createIntentId(seed: string): string {
  return `intent_${seed}_${Date.now().toString(36)}`;
}

const EXACT_PHRASES: Record<string, IntentChipId> = {
  "more like this": "MORE_LIKE_THIS",
  "something like this": "MORE_LIKE_THIS",
  "more romantic": "MORE_ROMANCE",
  "more romance": "MORE_ROMANCE",
  darker: "DARKER",
  "something darker": "DARKER",
  "more revenge": "MORE_REVENGE",
  "revenge story": "MORE_REVENGE",
  "strong female lead": "STRONG_FEMALE_LEAD",
  "female lead": "STRONG_FEMALE_LEAD",
  "surprise me": "SURPRISE_ME",
  surprise: "SURPRISE_ME",
};

/**
 * Layered parser:
 * 1. exact known phrase / chip mapping
 * 2. controlled vocabulary matching
 * 3. deterministic compound normalization
 * 4. optional semantic fallback (isolated; noop by default)
 */
export function createIntentParser(
  semanticFallback: SemanticFallback = createNoopSemanticFallback(),
): IntentParser {
  return {
    parseChip(chipId, context) {
      const intentId = createIntentId(chipId);
      const intent = chipToIntent(chipId, context, intentId);
      return { intent, ok: intent.confidence >= 0.4 };
    },

    async parse(input, context, options = {}) {
      const normalized = input.trim().toLowerCase().replace(/\s+/g, " ");
      const intentId = createIntentId("nl");

      if (!normalized) {
        return unresolved(intentId, input, context, ["empty_input"]);
      }

      // 1. Exact phrase → chip
      const exact = EXACT_PHRASES[normalized];
      if (exact) {
        const intent = {
          ...chipToIntent(exact, context, intentId),
          source: "natural_language" as const,
          parserSource: "exact_phrase" as const,
          rawInput: undefined, // minimize stored private text
          confidence: 0.9,
        };
        return { intent, ok: true };
      }

      // 2–3. Vocabulary + compound
      const compound = parseCompound(normalized, context, intentId);
      if (compound) {
        return { intent: compound, ok: compound.confidence >= 0.45 };
      }

      // 4. Optional semantic fallback
      if (options.allowSemanticFallback) {
        const partial = await semanticFallback.parse(normalized, context);
        if (partial) {
          return {
            intent: {
              source: "natural_language",
              lifetime: "NEXT_ITEM",
              confidence: Math.min(0.6, partial.confidence ?? 0.4),
              unresolvedTerms: partial.unresolvedTerms ?? [],
              parserSource: "fallback_stub",
              language: context.language,
              ...partial,
              intentId,
            },
            ok: (partial.confidence ?? 0) >= 0.45,
          };
        }
      }

      return unresolved(intentId, input, context, tokenizeUnknown(normalized));
    },
  };
}

function parseCompound(
  text: string,
  context: IntentParseContext,
  intentId: string,
): IntentModel | null {
  const genres: SceneGenre[] = [];
  const tropes: SceneTrope[] = [];
  const unresolved: string[] = [];
  let emotionalTone: EmotionalTone | undefined;
  let romanceIntensityMin: number | undefined;
  let suspenseIntensityMin: number | undefined;
  let similarity = false;
  let preferProtagonist = false;
  let preferFemaleLead = false;
  let revenge = false;
  let hits = 0;

  if (/like this|similar/.test(text)) {
    similarity = true;
    hits += 1;
  }
  if (/dark|darker|grim/.test(text)) {
    emotionalTone = "dark";
    suspenseIntensityMin = 0.55;
    hits += 1;
  }
  if (/romantic|romance/.test(text)) {
    genres.push("romance");
    romanceIntensityMin = 0.55;
    hits += 1;
  }
  if (/revenge/.test(text)) {
    tropes.push("revenge");
    genres.push("revenge");
    revenge = true;
    hits += 1;
  }
  if (/female lead|woman lead|heroine/.test(text)) {
    preferProtagonist = true;
    preferFemaleLead = true;
    unresolved.push("female_lead_metadata_unavailable");
    hits += 1;
  }
  if (/intense|more intense|escalat/.test(text)) {
    suspenseIntensityMin = Math.max(suspenseIntensityMin ?? 0, 0.6);
    hits += 1;
  }
  if (/thriller/.test(text)) {
    genres.push("thriller");
    hits += 1;
  }
  if (/surprise|random|anything/.test(text)) {
    return {
      intentId,
      source: "natural_language",
      lifetime: "NEXT_ITEM",
      confidence: 0.75,
      surprise: true,
      unresolvedTerms: [],
      parserSource: "vocabulary",
      language: context.language,
      exclusions: {
        contentIds: context.contentId ? [context.contentId] : [],
        seriesIds: context.seriesId ? [context.seriesId] : [],
      },
    };
  }

  if (hits === 0) return null;

  // Conflicting soft handling: romance + darker both allowed (compound)
  const confidence = Math.min(0.85, 0.45 + hits * 0.12);

  return {
    intentId,
    source: "natural_language",
    lifetime: "NEXT_ITEM",
    confidence,
    genres: unique(genres),
    tropes: unique(tropes),
    ...(emotionalTone ? { emotionalTone } : {}),
    ...(romanceIntensityMin !== undefined ? { romanceIntensityMin } : {}),
    ...(suspenseIntensityMin !== undefined ? { suspenseIntensityMin } : {}),
    ...(similarity && context.contentId
      ? { similarityToContentId: context.contentId }
      : {}),
    ...(similarity && context.seriesId
      ? { similarityToSeriesId: context.seriesId }
      : {}),
    preferProtagonist,
    preferFemaleLead,
    emotionalIntensityDelta: revenge || emotionalTone === "dark" ? 0.15 : undefined,
    unresolvedTerms: unresolved,
    parserSource: hits > 1 ? "compound" : "vocabulary",
    language: context.language,
    exclusions: {
      contentIds: context.contentId ? [context.contentId] : [],
    },
  };
}

function unresolved(
  intentId: string,
  _raw: string,
  context: IntentParseContext,
  terms: string[],
): IntentParseResult {
  return {
    ok: false,
    intent: {
      intentId,
      source: "natural_language",
      lifetime: "NEXT_ITEM",
      confidence: 0.1,
      unresolvedTerms: terms,
      parserSource: "unresolved",
      language: context.language,
    },
  };
}

function tokenizeUnknown(text: string): string[] {
  return text
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 8);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function isIntentChipId(value: string): value is IntentChipId {
  return (INTENT_CHIP_IDS as readonly string[]).includes(value);
}
