/**
 * Canonical launch event names (L1.5).
 * Legacy names remain valid for mobile / recommendation; prefer these on web launch path.
 */
export const LAUNCH_EVENT_NAMES = [
  "page_view",
  "first_meaningful_play",
  "play",
  "pause",
  "buffer_start",
  "buffer_end",
  "watch_progress",
  "episode_complete",
  "episode_leave",
  "series_continue",
  "series_complete",
  "feed_swipe",
  "content_impression",
  "content_open",
  "like",
  "follow",
  "intent_open",
  "intent_select",
  "share_open",
  "share_copy",
  "share_native",
  "share_landing",
  "share_play",
] as const;

export type LaunchEventName = (typeof LAUNCH_EVENT_NAMES)[number];

export const LAUNCH_EVENT_NAME_SET: ReadonlySet<string> = new Set(LAUNCH_EVENT_NAMES);

/** Map legacy product events → launch contract where 1:1. */
export const LEGACY_TO_LAUNCH: Partial<Record<string, LaunchEventName>> = {
  video_started: "play",
  video_paused: "pause",
  buffering_started: "buffer_start",
  buffering_ended: "buffer_end",
  video_completed: "episode_complete",
  episode_auto_continued: "series_continue",
  series_end_reached: "series_complete",
  feed_swiped_next: "feed_swipe",
  feed_swiped_previous: "feed_swipe",
  like_tapped: "like",
  follow_tapped: "follow",
  intent_sheet_opened: "intent_open",
  intent_chip_selected: "intent_select",
  share_tapped: "share_open",
  deep_link_opened: "share_landing",
  app_opened: "page_view",
};
