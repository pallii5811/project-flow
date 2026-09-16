import type {
  EmotionalTone,
  SceneGenre,
  SceneTrope,
} from "../../scene-graph/model/taxonomy";
import type {
  IntentChipId,
  IntentLifetime,
  IntentSource,
  ParserSource,
} from "./taxonomy";

export type IntentModel = {
  intentId: string;
  chipId?: IntentChipId;
  source: IntentSource;
  lifetime: IntentLifetime;
  confidence: number;
  rawInput?: string;
  genres?: SceneGenre[];
  tropes?: SceneTrope[];
  emotionalTone?: EmotionalTone;
  emotionalIntensityDelta?: number;
  romanceIntensityMin?: number;
  suspenseIntensityMin?: number;
  cliffhangerStrengthMin?: number;
  preferProtagonist?: boolean;
  /** Soft preference when Scene Graph has no sex/gender field — degrade if unresolved. */
  preferFemaleLead?: boolean;
  similarityToContentId?: string;
  similarityToSeriesId?: string;
  surprise?: boolean;
  exclusions?: {
    contentIds?: string[];
    seriesIds?: string[];
  };
  language?: string;
  unresolvedTerms: string[];
  parserSource: ParserSource;
};

export type IntentParseContext = {
  contentId: string | null;
  seriesId: string | null;
  episodeId: string | null;
  genres: string[];
  tropes: string[];
  language: string;
  recentContentIds: string[];
};

export type IntentParseResult = {
  intent: IntentModel;
  ok: boolean;
};

/** Temporary contextual boost — does NOT mutate UserTasteProfile. */
export type IntentRecommendationBias = {
  intentId: string;
  genres: SceneGenre[];
  tropes: SceneTrope[];
  emotionalTone?: EmotionalTone;
  romanceBoost: number;
  suspenseBoost: number;
  similarityContentId?: string;
  similaritySeriesId?: string;
  surprise: boolean;
  preferProtagonist: boolean;
  weight: number;
};

export type IntentResolutionStatus =
  | "resolved"
  | "weak_match"
  | "unresolved";

export type IntentCandidate = {
  contentId: string;
  seriesId: string;
  score: number;
  matchStrength: number;
  matchedFields: string[];
};

export type IntentResolution = {
  intentId: string;
  status: IntentResolutionStatus;
  intent: IntentModel;
  candidates: IntentCandidate[];
  resultCount: number;
  matchStrength: number;
  latencyMs: number;
  unresolvedTerms: string[];
};
