/**
 * Configurable Demand Graph thresholds — never vanity "100k users" constants.
 * QUERY VOLUME ≠ DEMAND. Validation requires multiple independent signals.
 */

export type DemandThresholds = {
  /** Minimum unique users before POSSIBLE_GAP can promote. */
  possibleGapUniqueUsers: number;
  /** Minimum unique users for REPEATED_GAP. */
  repeatedGapUniqueUsers: number;
  /** Minimum requests for REPEATED_GAP (with unique users). */
  repeatedGapRequestCount: number;
  /** Max contribution of any single anonymous id to unique_users (anti-obsession). */
  maxRequestsPerUserCounted: number;
  /** Match strength below this → weak catalog match. */
  weakMatchCeiling: number;
  /** Match strength at/above this → no content gap (strong match). */
  strongMatchFloor: number;
  /** Related completion rate for behavioral validation. */
  validatedCompletionRate: number;
  /** Minimum related plays for completion rate to count. */
  validatedMinRelatedPlays: number;
  /** Minimum unique users for BEHAVIORALLY_VALIDATED. */
  validatedUniqueUsers: number;
  /** Half-life for temporal decay of request weight (ms). ~30 days. */
  requestHalfLifeMs: number;
  /** Canonical key schema version. */
  keyVersion: number;
};

export const DEFAULT_DEMAND_THRESHOLDS: DemandThresholds = {
  possibleGapUniqueUsers: 3,
  repeatedGapUniqueUsers: 8,
  repeatedGapRequestCount: 12,
  maxRequestsPerUserCounted: 5,
  weakMatchCeiling: 0.35,
  strongMatchFloor: 0.55,
  validatedCompletionRate: 0.4,
  validatedMinRelatedPlays: 5,
  validatedUniqueUsers: 10,
  requestHalfLifeMs: 30 * 24 * 60 * 60 * 1000,
  keyVersion: 1,
};
