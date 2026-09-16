import type { EmotionalTone, SceneGenre, SceneTrope } from "../../scene-graph/model/taxonomy";
import type { IntentChipId } from "./taxonomy";
import type { IntentModel, IntentParseContext } from "./types";

function base(
  chipId: IntentChipId,
  context: IntentParseContext,
  intentId: string,
): IntentModel {
  return {
    intentId,
    chipId,
    source: "chip",
    lifetime: "NEXT_ITEM",
    confidence: 0.95,
    unresolvedTerms: [],
    parserSource: "chip",
    language: context.language,
    exclusions: {
      contentIds: context.contentId ? [context.contentId] : [],
    },
  };
}

/**
 * Chip → structured intent. Context-aware for MORE_LIKE_THIS / DARKER.
 */
export function chipToIntent(
  chipId: IntentChipId,
  context: IntentParseContext,
  intentId: string,
): IntentModel {
  switch (chipId) {
    case "MORE_LIKE_THIS":
      return {
        ...base(chipId, context, intentId),
        similarityToContentId: context.contentId ?? undefined,
        similarityToSeriesId: context.seriesId ?? undefined,
        genres: (context.genres.filter(isGenre) as SceneGenre[]) || undefined,
        tropes: (context.tropes.filter(isTrope) as SceneTrope[]) || undefined,
        confidence: context.contentId ? 0.95 : 0.5,
        unresolvedTerms: context.contentId ? [] : ["no_current_content"],
      };
    case "MORE_ROMANCE":
      return {
        ...base(chipId, context, intentId),
        genres: ["romance"],
        romanceIntensityMin: 0.55,
        emotionalIntensityDelta: 0.15,
      };
    case "DARKER":
      return {
        ...base(chipId, context, intentId),
        emotionalTone: "dark" as EmotionalTone,
        suspenseIntensityMin: 0.55,
        emotionalIntensityDelta: 0.2,
        // Context: keep a soft similarity to current story when available
        similarityToSeriesId: context.seriesId ?? undefined,
        genres: softContextGenres(context),
      };
    case "MORE_REVENGE":
      return {
        ...base(chipId, context, intentId),
        tropes: ["revenge"],
        genres: ["revenge"],
        emotionalIntensityDelta: 0.15,
      };
    case "STRONG_FEMALE_LEAD":
      return {
        ...base(chipId, context, intentId),
        preferProtagonist: true,
        preferFemaleLead: true,
        // Scene Graph V0 has no gender field — mark soft unresolved dimension
        unresolvedTerms: ["female_lead_metadata_unavailable"],
        confidence: 0.7,
      };
    case "SURPRISE_ME":
      return {
        ...base(chipId, context, intentId),
        surprise: true,
        exclusions: {
          contentIds: context.contentId ? [context.contentId] : [],
          seriesIds: context.seriesId ? [context.seriesId] : [],
        },
      };
    default: {
      const _exhaustive: never = chipId;
      return _exhaustive;
    }
  }
}

function isGenre(value: string): boolean {
  return [
    "romance",
    "thriller",
    "revenge",
    "fantasy",
    "comedy",
    "crime",
    "mystery",
    "family",
    "drama",
    "action",
  ].includes(value);
}

function isTrope(value: string): boolean {
  return [
    "betrayal",
    "secret_identity",
    "billionaire",
    "enemies_to_lovers",
    "forced_marriage",
    "revenge",
    "hidden_heir",
    "amnesia",
    "mistaken_identity",
    "second_chance",
    "forbidden_love",
    "power_reversal",
  ].includes(value);
}

function softContextGenres(context: IntentParseContext): SceneGenre[] | undefined {
  const genres = context.genres.filter(isGenre) as SceneGenre[];
  return genres.length > 0 ? genres.slice(0, 2) : undefined;
}
