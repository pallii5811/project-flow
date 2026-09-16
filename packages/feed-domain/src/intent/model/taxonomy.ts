/**
 * Controlled Intent V0 taxonomy — chips only, intentionally small.
 */

export const INTENT_CHIP_IDS = [
  "MORE_LIKE_THIS",
  "MORE_ROMANCE",
  "DARKER",
  "MORE_REVENGE",
  "STRONG_FEMALE_LEAD",
  "SURPRISE_ME",
] as const;

export type IntentChipId = (typeof INTENT_CHIP_IDS)[number];

export const INTENT_CHIP_LABELS: Record<IntentChipId, string> = {
  MORE_LIKE_THIS: "More like this",
  MORE_ROMANCE: "More romance",
  DARKER: "Darker",
  MORE_REVENGE: "More revenge",
  STRONG_FEMALE_LEAD: "Stronger female lead",
  SURPRISE_ME: "Surprise me",
};

export type IntentSource = "chip" | "natural_language";

export type IntentLifetime = "NEXT_ITEM" | "SESSION" | "SERIES_CONTEXT";

export type ParserSource =
  | "chip"
  | "exact_phrase"
  | "vocabulary"
  | "compound"
  | "unresolved"
  | "fallback_stub";

/** Explicit ranking hierarchy (documented for product + tests). */
export const INTENT_PRIORITY = [
  "continuation",
  "explicit_intent",
  "learned_taste",
  "editorial_popularity",
  "exploration",
] as const;
