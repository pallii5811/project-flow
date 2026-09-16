export type FirstPlayTiming = {
  appOpenTimestamp: number;
  firstPlayAttemptTimestamp: number | null;
  videoReadyTimestamp: number | null;
  actualPlaybackTimestamp: number | null;
};

export function createFirstPlayTiming(now = Date.now()): FirstPlayTiming {
  return {
    appOpenTimestamp: now,
    firstPlayAttemptTimestamp: null,
    videoReadyTimestamp: null,
    actualPlaybackTimestamp: null,
  };
}

export function computeTimeToFirstPlay(timing: FirstPlayTiming): number | null {
  if (timing.actualPlaybackTimestamp === null) {
    return null;
  }
  return Math.max(0, timing.actualPlaybackTimestamp - timing.appOpenTimestamp);
}

export type WatchSessionStats = {
  sessionId: string;
  startedAt: number;
  videosViewed: number;
  videosCompleted: number;
  videosSkipped: number;
  watchDurationMs: number;
};

export function createWatchSessionStats(sessionId: string, now = Date.now()): WatchSessionStats {
  return {
    sessionId,
    startedAt: now,
    videosViewed: 0,
    videosCompleted: 0,
    videosSkipped: 0,
    watchDurationMs: 0,
  };
}
