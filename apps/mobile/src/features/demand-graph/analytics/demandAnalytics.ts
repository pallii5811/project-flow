import type { AnalyticsClient } from "@project-flow/analytics";

function trackSafe(
  analytics: AnalyticsClient,
  event: Parameters<AnalyticsClient["track"]>[0],
  properties: Record<string, string | number | boolean | null>,
): void {
  try {
    analytics.track(event, properties);
  } catch {
    // never block
  }
}

export function trackDemandSignalCreated(
  analytics: AnalyticsClient,
  props: {
    demand_pattern_id: string;
    source: string;
    result_count: number;
    match_strength: number;
    validation_state: string;
  },
): void {
  trackSafe(analytics, "demand_signal_created", props);
}

export function trackDemandSignalNormalized(
  analytics: AnalyticsClient,
  props: { demand_pattern_id: string; canonical_key: string },
): void {
  trackSafe(analytics, "demand_signal_normalized", props);
}

export function trackDemandGapEvent(
  analytics: AnalyticsClient,
  event:
    | "demand_gap_detected"
    | "demand_gap_repeated"
    | "demand_gap_validated"
    | "demand_signal_satisfied",
  props: {
    demand_pattern_id: string;
    validation_state: string;
    confidence_level: string;
  },
): void {
  trackSafe(analytics, event, props);
}

export function trackDemandPatternQueried(
  analytics: AnalyticsClient,
  props: { result_count: number },
): void {
  trackSafe(analytics, "demand_pattern_queried", props);
}

export function trackProductionSignalGenerated(
  analytics: AnalyticsClient,
  props: { demand_pattern_id: string; confidence_level: string },
): void {
  trackSafe(analytics, "production_signal_generated", props);
}
