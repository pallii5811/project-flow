import type { DemandThresholds } from "../model/thresholds";
import type {
  BehavioralEvidence,
  ConfidenceLevel,
  DemandGapKind,
  DemandLifecycleState,
  DemandPatternRecord,
  DemandSignal,
} from "../model/types";

function recomputeRates(e: BehavioralEvidence): void {
  e.relatedPlayRate =
    e.relatedContentImpressions > 0
      ? e.relatedContentPlays / e.relatedContentImpressions
      : 0;
  e.relatedCompletionRate =
    e.relatedContentPlays > 0
      ? e.relatedContentCompletions / e.relatedContentPlays
      : 0;
  e.relatedNextItemRate =
    e.relatedContentPlays > 0
      ? e.relatedContentNextItem / e.relatedContentPlays
      : 0;
}

/**
 * Confidence = how much evidence we have.
 * NOT predicted series success / guaranteed audience.
 */
export function computeConfidence(
  evidence: BehavioralEvidence,
  thresholds: DemandThresholds,
): { level: ConfidenceLevel; score: number } {
  let score = 0;
  score += Math.min(0.35, evidence.uniqueUsers / 40);
  score += Math.min(0.2, evidence.repeatUsers / 15);
  if (evidence.relatedContentPlays >= thresholds.validatedMinRelatedPlays) {
    score += Math.min(0.25, evidence.relatedCompletionRate * 0.25);
    score += Math.min(0.1, evidence.relatedNextItemRate * 0.1);
  }
  score += Math.min(0.1, (evidence.shares + evidence.follows) / 20);

  const level: ConfidenceLevel =
    score >= 0.65 ? "high" : score >= 0.35 ? "medium" : "low";
  return { level, score: Number(score.toFixed(3)) };
}

export function deriveGapKind(
  pattern: DemandPatternRecord,
  signal: DemandSignal,
  thresholds: DemandThresholds,
): DemandGapKind {
  if (pattern.normalized.gapKindHint === "INTENT_GAP") {
    return "INTENT_GAP";
  }
  if (signal.matchStrength >= thresholds.strongMatchFloor && signal.resultCount > 0) {
    return "NO_GAP";
  }
  if (
    signal.resultCount === 0 ||
    signal.matchStrength < thresholds.weakMatchCeiling
  ) {
    return "CONTENT_GAP";
  }
  return pattern.gapKind === "INTENT_GAP" ? "INTENT_GAP" : "NO_GAP";
}

/**
 * Lifecycle transitions — never auto-SATISFIED.
 * CONTENT_GAP only can climb toward PRODUCTION_SIGNAL.
 */
export function deriveLifecycleState(
  pattern: DemandPatternRecord,
  thresholds: DemandThresholds,
): DemandLifecycleState {
  if (pattern.state === "SATISFIED") return "SATISFIED";
  if (pattern.state === "PRODUCTION_SIGNAL") return "PRODUCTION_SIGNAL";

  const { evidence, gapKind } = pattern;

  if (gapKind === "INTENT_GAP") {
    return evidence.requestCount > 0 ? "NORMALIZED" : "DISCOVERED";
  }
  if (gapKind === "NO_GAP") {
    return "NORMALIZED";
  }

  // CONTENT_GAP path
  const behaviorallyReady =
    evidence.uniqueUsers >= thresholds.validatedUniqueUsers &&
    evidence.relatedContentPlays >= thresholds.validatedMinRelatedPlays &&
    evidence.relatedCompletionRate >= thresholds.validatedCompletionRate;

  if (behaviorallyReady && pattern.confidenceLevel !== "low") {
    return "BEHAVIORALLY_VALIDATED";
  }

  if (
    evidence.uniqueUsers >= thresholds.repeatedGapUniqueUsers &&
    evidence.cappedRequestCount >= thresholds.repeatedGapRequestCount
  ) {
    return "REPEATED_GAP";
  }

  if (evidence.uniqueUsers >= thresholds.possibleGapUniqueUsers) {
    return "POSSIBLE_GAP";
  }

  return "NORMALIZED";
}

export function applyTemporalDecay(
  activityScore: number,
  lastSeen: number,
  now: number,
  halfLifeMs: number,
): number {
  const age = Math.max(0, now - lastSeen);
  if (age === 0 || halfLifeMs <= 0) return activityScore;
  return activityScore * Math.pow(0.5, age / halfLifeMs);
}

export function trendDirection(
  activityScore: number,
  decayed: number,
): "rising" | "stable" | "cooling" {
  if (activityScore > decayed * 1.2) return "rising";
  if (decayed < activityScore * 0.7) return "cooling";
  return "stable";
}

export { recomputeRates };
