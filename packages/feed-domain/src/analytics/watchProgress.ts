/**
 * Throttle watch_progress heartbeats.
 * Default: emit on 10/25/50/75/95% thresholds and at most every `intervalMs`.
 */

export type WatchProgressSample = {
  contentId: string;
  positionMs: number;
  durationMs: number;
};

export type WatchProgressEmitter = {
  /** Returns true when a heartbeat should be sent. */
  shouldEmit(sample: WatchProgressSample, nowMs?: number): boolean;
  /** Force a final progress event (episode end / leave). */
  forceNext(): void;
  reset(contentId?: string): void;
};

const THRESHOLDS = [10, 25, 50, 75, 95] as const;

export function createWatchProgressThrottle(
  intervalMs = 5_000,
): WatchProgressEmitter {
  let lastEmitAt = 0;
  let lastContentId: string | null = null;
  const firedThresholds = new Set<number>();
  let force = false;

  return {
    shouldEmit(sample, nowMs = Date.now()) {
      if (sample.contentId !== lastContentId) {
        lastContentId = sample.contentId;
        firedThresholds.clear();
        lastEmitAt = 0;
      }
      const pct =
        sample.durationMs > 0
          ? Math.min(100, Math.round((sample.positionMs / sample.durationMs) * 100))
          : 0;

      if (force) {
        force = false;
        lastEmitAt = nowMs;
        return true;
      }

      for (const threshold of THRESHOLDS) {
        if (pct >= threshold && !firedThresholds.has(threshold)) {
          firedThresholds.add(threshold);
          lastEmitAt = nowMs;
          return true;
        }
      }

      if (nowMs - lastEmitAt >= intervalMs && sample.positionMs > 0) {
        lastEmitAt = nowMs;
        return true;
      }
      return false;
    },
    forceNext() {
      force = true;
    },
    reset(contentId) {
      if (contentId && contentId !== lastContentId) return;
      lastEmitAt = 0;
      firedThresholds.clear();
      force = false;
      if (!contentId) lastContentId = null;
    },
  };
}
