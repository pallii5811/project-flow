import type { AnalyticsClient } from "@project-flow/analytics";

import type { ContentItem } from "../model/types";
import {
  computeTimeToFirstPlay,
  type FirstPlayTiming,
} from "../session/timing";

export function contentProps(item: ContentItem): Record<string, string | number | boolean | null> {
  return {
    content_id: item.id,
    series_id: item.seriesId,
    episode_id: item.episodeId,
  };
}

export function trackFirstMeaningfulPlay(
  analytics: AnalyticsClient,
  timing: FirstPlayTiming,
  item: ContentItem,
): void {
  const ttfp = computeTimeToFirstPlay(timing);
  analytics.track("first_meaningful_play", {
    ...contentProps(item),
    app_open_timestamp: timing.appOpenTimestamp,
    first_play_attempt_timestamp: timing.firstPlayAttemptTimestamp,
    video_ready_timestamp: timing.videoReadyTimestamp,
    actual_playback_timestamp: timing.actualPlaybackTimestamp,
    time_to_first_play: ttfp,
  });
}
