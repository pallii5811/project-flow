import type { AnalyticsClient } from "@project-flow/analytics";

export function trackSceneMetadataLoaded(
  analytics: AnalyticsClient,
  props: {
    scene_count: number;
    series_count: number;
    metadata_version: number;
    schema_version: number;
  },
): void {
  try {
    analytics.track("scene_metadata_loaded", props);
  } catch {
    // never block
  }
}

export function trackSceneQueryExecuted(
  analytics: AnalyticsClient,
  props: {
    query_type: string;
    result_count: number;
    latency_ms: number;
    schema_version: number;
  },
): void {
  try {
    analytics.track("scene_query_executed", props);
  } catch {
    // never block
  }
}

export function trackSceneSignalUsed(
  analytics: AnalyticsClient,
  props: {
    content_id: string;
    series_id: string;
    signal_summary: number;
  },
): void {
  try {
    analytics.track("scene_signal_used", props);
  } catch {
    // never block
  }
}
