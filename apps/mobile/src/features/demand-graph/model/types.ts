import type { EmotionalTone, SceneGenre, SceneTrope } from "../../scene-graph/model/taxonomy";

export type DemandSignalSource =
  | "intent_unresolved"
  | "intent_weak_match"
  | "intent_result_played"
  | "intent_result_completed"
  | "intent_result_skipped"
  | "intent_resolved"
  | "more_like_this_repeat"
  | "catalog_gap"
  | "related_behavior";

export type DemandGapKind = "CONTENT_GAP" | "INTENT_GAP" | "NO_GAP";

export type DemandLifecycleState =
  | "DISCOVERED"
  | "NORMALIZED"
  | "POSSIBLE_GAP"
  | "REPEATED_GAP"
  | "BEHAVIORALLY_VALIDATED"
  | "PRODUCTION_SIGNAL"
  | "SATISFIED";

export type ConfidenceLevel = "low" | "medium" | "high";

export type NormalizedDemandPattern = {
  genres: SceneGenre[];
  tropes: SceneTrope[];
  emotionalTone?: EmotionalTone;
  emotionalIntensityBucket?: "low" | "mid" | "high";
  characterRoles?: string[];
  relationshipPatterns?: string[];
  setting?: string;
  language?: string;
  /** Soft flags that Scene Graph may not fully support. */
  preferFemaleLead?: boolean;
  surprise?: boolean;
  unresolvedFields: string[];
  /** CONTENT_GAP vs INTENT_GAP discrimination seeds. */
  gapKindHint: DemandGapKind;
};

export type DemandSignal = {
  id: string;
  source: DemandSignalSource;
  timestamp: number;
  country?: string;
  language?: string;
  normalized: NormalizedDemandPattern;
  unresolvedFields: string[];
  contextContentId?: string;
  contextSeriesId?: string;
  resultCount: number;
  matchStrength: number;
  /** Anonymous session/user hash — never raw PII. */
  anonymousIdHash: string;
  /** Dedup key: session + intent request. */
  dedupeKey: string;
  metadataVersion: number;
  relatedContentId?: string;
};

export type BehavioralEvidence = {
  uniqueUsers: number;
  requestCount: number;
  repeatUsers: number;
  /** Requests after per-user cap (for anti-obsession visibility). */
  cappedRequestCount: number;
  relatedContentImpressions: number;
  relatedContentPlays: number;
  relatedContentCompletions: number;
  relatedContentSkips: number;
  relatedContentWatchTimeMs: number;
  relatedContentNextItem: number;
  shares: number;
  follows: number;
  returns: number;
  /** Derived rates — OBSERVED components, not a forecast. */
  relatedPlayRate: number;
  relatedCompletionRate: number;
  relatedNextItemRate: number;
};

export type ClosestContentRef = {
  contentId: string;
  seriesId: string;
  overlapScore: number;
  matchedFields: string[];
};

export type SegmentCounts = {
  /** country → unique-ish request weight */
  byCountry: Record<string, number>;
  byLanguage: Record<string, number>;
};

export type DemandPatternRecord = {
  patternId: string;
  canonicalKey: string;
  keyVersion: number;
  normalized: NormalizedDemandPattern;
  state: DemandLifecycleState;
  gapKind: DemandGapKind;
  confidenceLevel: ConfidenceLevel;
  /** Evidence of how much data we have — NOT predicted success. */
  confidenceScore: number;
  evidence: BehavioralEvidence;
  closestContent: ClosestContentRef | null;
  segments: SegmentCounts;
  firstSeen: number;
  lastSeen: number;
  /** Decayed request activity score for temporal soft decay. */
  activityScore: number;
  relatedPatternIds: string[];
  /** Post-launch: content claimed to address this pattern. */
  satisfyingContentIds: string[];
  postLaunch: {
    impressions: number;
    plays: number;
    completions: number;
    shares: number;
    follows: number;
  } | null;
  signalIds: string[];
};

export type ProductionSignal = {
  demandPatternId: string;
  canonicalKey: string;
  demandPattern: NormalizedDemandPattern;
  targetMarkets: { countries: string[]; languages: string[] };
  dominantTropes: SceneTrope[];
  desiredTone?: EmotionalTone;
  protagonistPattern?: string;
  relationshipPattern?: string;
  closestContent: ClosestContentRef | null;
  evidenceSummary: BehavioralEvidence;
  confidenceLevel: ConfidenceLevel;
  confidenceNote: string;
  firstSeen: number;
  lastSeen: number;
  trendDirection: "rising" | "stable" | "cooling";
  state: DemandLifecycleState;
  /** Explicit: not a viewer forecast. */
  disclaimer: string;
};

export type DemandQuery = {
  state?: DemandLifecycleState;
  gapKind?: DemandGapKind;
  minConfidence?: ConfidenceLevel;
  language?: string;
  country?: string;
  limit?: number;
};
