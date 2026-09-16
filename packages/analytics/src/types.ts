/**
 * Analytics event names for PROJECT FLOW.
 * Includes L1.5 canonical launch events + legacy product events.
 */
import type { LaunchEventName } from "./launchEvents";

export type AnalyticsEventName =
  | LaunchEventName
  | "app_opened"
  | "app_backgrounded"
  | "app_foregrounded"
  | "first_play_attempted"
  | "video_ready"
  | "video_started"
  | "video_paused"
  | "video_resumed"
  | "video_completed"
  | "video_skipped"
  | "video_replayed"
  | "feed_swiped_next"
  | "feed_swiped_previous"
  | "follow_tapped"
  | "like_tapped"
  | "share_tapped"
  | "caption_toggled"
  | "playback_error"
  | "buffering_started"
  | "buffering_ended"
  | "deep_link_opened"
  | "episode_continued"
  | "episode_resume_started"
  | "episode_resume_position_restored"
  | "next_episode_resolved"
  | "next_episode_prepare_started"
  | "next_episode_ready"
  | "next_episode_prepare_failed"
  | "episode_auto_continued"
  | "episode_continue_tapped"
  | "episode_transition_started"
  | "episode_transition_completed"
  | "series_completed"
  | "series_end_reached"
  | "recommendation_requested"
  | "recommendation_generated"
  | "recommendation_impression"
  | "recommendation_play_started"
  | "recommendation_completed"
  | "recommendation_skipped"
  | "recommendation_source_selected"
  | "recommendation_exploration_served"
  | "scene_metadata_loaded"
  | "scene_query_executed"
  | "scene_signal_used"
  | "intent_sheet_opened"
  | "intent_chip_selected"
  | "intent_text_submitted"
  | "intent_parsed"
  | "intent_resolved"
  | "intent_unresolved"
  | "intent_weak_match"
  | "intent_candidate_generated"
  | "intent_result_played"
  | "intent_result_completed"
  | "intent_result_skipped"
  | "demand_signal_created"
  | "demand_signal_normalized"
  | "demand_gap_detected"
  | "demand_gap_repeated"
  | "demand_gap_validated"
  | "demand_signal_satisfied"
  | "demand_pattern_queried"
  | "production_signal_generated";

export type AnalyticsPrimitive = string | number | boolean | null;

export type AnalyticsProperties = Record<string, AnalyticsPrimitive>;

/** Legacy payload shape — still accepted by providers. */
export type AnalyticsPayload = {
  event: AnalyticsEventName;
  timestamp: string;
  sessionId: string;
  properties?: AnalyticsProperties;
};

/**
 * Canonical envelope (L1). Single definition — do not duplicate.
 */
export type AnalyticsEnvelope = {
  event_id: string;
  event_name: AnalyticsEventName;
  timestamp: string;
  anonymous_user_id: string;
  session_id: string;
  content_id?: string | null;
  series_id?: string | null;
  episode_id?: string | null;
  source?: string | null;
  locale?: string | null;
  country?: string | null;
  platform?: string | null;
  viewport_class?: string | null;
  app_version?: string | null;
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  share_id?: string | null;
  properties?: AnalyticsProperties;
};

export type AnalyticsProvider = {
  track(payload: AnalyticsPayload | AnalyticsEnvelope): void | Promise<void>;
};

export type AnalyticsClient = {
  track(event: AnalyticsEventName, properties?: AnalyticsProperties): void;
  flush(): Promise<void>;
  identify(properties?: AnalyticsProperties): void;
  shutdown(): Promise<void>;
  getTransportDiagnostics?(): import("./transport/types").TransportDiagnostics;
};
