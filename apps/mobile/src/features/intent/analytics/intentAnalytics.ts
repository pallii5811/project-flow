import type { AnalyticsClient } from "@project-flow/analytics";

import type { IntentModel, IntentResolutionStatus } from "../model/types";

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

export function trackIntentSheetOpened(
  analytics: AnalyticsClient,
  sessionId: string,
  contentId: string | null,
): void {
  trackSafe(analytics, "intent_sheet_opened", {
    session_id: sessionId,
    content_id: contentId,
  });
}

export function trackIntentChipSelected(
  analytics: AnalyticsClient,
  props: { intent_id: string; session_id: string; intent_type: string },
): void {
  trackSafe(analytics, "intent_chip_selected", props);
}

export function trackIntentTextSubmitted(
  analytics: AnalyticsClient,
  props: { intent_id: string; session_id: string; input_length: number },
): void {
  // Do not store raw private text
  trackSafe(analytics, "intent_text_submitted", props);
}

export function trackIntentParsed(
  analytics: AnalyticsClient,
  intent: IntentModel,
  sessionId: string,
): void {
  trackSafe(analytics, "intent_parsed", {
    intent_id: intent.intentId,
    session_id: sessionId,
    source: intent.source,
    intent_type: intent.chipId ?? "nl",
    parser_source: intent.parserSource,
    confidence: Number(intent.confidence.toFixed(3)),
  });
}

export function trackIntentResolution(
  analytics: AnalyticsClient,
  props: {
    intent_id: string;
    session_id: string;
    status: IntentResolutionStatus;
    result_count: number;
    match_strength: number;
    intent_type: string;
    parser_source: string;
    confidence: number;
  },
): void {
  const event =
    props.status === "resolved"
      ? "intent_resolved"
      : props.status === "weak_match"
        ? "intent_weak_match"
        : "intent_unresolved";
  trackSafe(analytics, event, {
    intent_id: props.intent_id,
    session_id: props.session_id,
    result_count: props.result_count,
    match_strength: Number(props.match_strength.toFixed(3)),
    intent_type: props.intent_type,
    parser_source: props.parser_source,
    confidence: Number(props.confidence.toFixed(3)),
  });
}

export function trackIntentCandidateGenerated(
  analytics: AnalyticsClient,
  props: {
    intent_id: string;
    session_id: string;
    result_count: number;
    match_strength: number;
  },
): void {
  trackSafe(analytics, "intent_candidate_generated", props);
}

export function trackIntentResultPlayed(
  analytics: AnalyticsClient,
  props: {
    intent_id: string;
    session_id: string;
    selected_content_id: string;
    selected_series_id: string;
    match_strength: number;
  },
): void {
  trackSafe(analytics, "intent_result_played", props);
}

export function trackIntentResultCompleted(
  analytics: AnalyticsClient,
  props: {
    intent_id: string;
    session_id: string;
    selected_content_id: string;
    selected_series_id: string;
  },
): void {
  trackSafe(analytics, "intent_result_completed", props);
}

export function trackIntentResultSkipped(
  analytics: AnalyticsClient,
  props: {
    intent_id: string;
    session_id: string;
    selected_content_id: string;
    selected_series_id: string;
  },
): void {
  trackSafe(analytics, "intent_result_skipped", props);
}
