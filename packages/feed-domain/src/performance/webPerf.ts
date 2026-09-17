export const WEB_PERF_MARKS = [
  "page_start",
  "app_shell_ready",
  "content_metadata_ready",
  "poster_visible",
  "video_load_started",
  "video_can_play",
  "video_play_started",
  "first_meaningful_play",
  "episode_transition_started",
  "episode_first_frame_played",
] as const;

export type WebPerfMark = (typeof WEB_PERF_MARKS)[number];

export type WebPerfTiming = {
  mark(name: WebPerfMark, timestamp?: number): void;
  get(name: WebPerfMark): number | null;
  /** ms from `page_start` → `first_meaningful_play`; null until play is marked. */
  timeToFirstPlay(): number | null;
  /** ms between two marks; null if either missing. */
  delta(from: WebPerfMark, to: WebPerfMark): number | null;
  /** Absolute ms timeline snapshot for reporting. */
  snapshot(): Partial<Record<WebPerfMark, number>>;
};

function navigationPageStartMs(fallbackNow: () => number): number {
  if (typeof performance === "undefined") return fallbackNow();
  // Navigation Timing Level 2: timeOrigin is the document navigation start.
  // first_meaningful_play is marked at the first frame on screen:
  // requestVideoFrameCallback where it exists, the `playing` event otherwise.
  return performance.timeOrigin;
}

function nowMs(): number {
  if (typeof performance !== "undefined") {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
}

/**
 * Cold-start timing anchored to navigation `timeOrigin` when available.
 * Do not claim &lt;1.5s unless measured from this clock.
 */
export function createWebPerfTiming(now: () => number = nowMs): WebPerfTiming {
  const marks = new Map<WebPerfMark, number>();
  marks.set("page_start", navigationPageStartMs(now));

  return {
    mark(name, timestamp = now()) {
      if (!marks.has(name)) {
        marks.set(name, timestamp);
      }
    },
    get(name) {
      return marks.get(name) ?? null;
    },
    timeToFirstPlay() {
      return this.delta("page_start", "first_meaningful_play");
    },
    delta(from, to) {
      const a = marks.get(from);
      const b = marks.get(to);
      if (a == null || b == null) return null;
      return Math.max(0, b - a);
    },
    snapshot() {
      const out: Partial<Record<WebPerfMark, number>> = {};
      for (const [key, value] of marks) out[key] = value;
      return out;
    },
  };
}
