/**
 * What the player does when playback goes wrong (DECISIONI.md decision 2):
 * every activation ends playing, in a visible error followed by a skip, or at
 * a tap-to-play gate — never on a poster forever. Pure decisions, tested
 * without a browser; Html5PlayerAdapter only executes them.
 */

/** Waits before re-attaching a source after a network failure. */
export const NETWORK_RETRY_DELAYS_MS = [1_000, 3_000] as const;

/**
 * An active episode that is not playing and has received no media for this
 * long is re-attached once, then failed. Measured from the last progress
 * (playlist, segment, frame), not from the swipe: a slow phone that keeps
 * receiving data is never cut off (throttled first play is about 8 s).
 */
export const NO_PROGRESS_WATCHDOG_MS = 10_000;

export type FatalKind = "network" | "media" | "other";

export type FatalErrorInput = {
  kind: FatalKind;
  /** HTTP status of the failed request, when there was a response. */
  httpStatus?: number | null | undefined;
  /** navigator.onLine at the time of the error. */
  online: boolean;
  /** Network re-attaches already spent in this activation. */
  networkRetries: number;
  /** Media recoveries already spent on this source. */
  mediaRecoveries: number;
};

export type RecoveryAction =
  /** Re-attach the source after `delayMs`. */
  | { action: "retry"; delayMs: number }
  /** No network: keep the source dead and re-attach when the browser is back online. */
  | { action: "wait_online" }
  /** hls.js recoverMediaError(). */
  | { action: "recover_media" }
  /** Give up: an active episode shows its error. */
  | { action: "fail"; mediaErrorCode: 2 | 3 | 4 };

/**
 * A request that answered 4xx will answer the same again: fail at once. A
 * missing network is not the episode's fault: wait for it rather than spend
 * retries. Anything else transient gets a few spaced retries.
 */
export function decideFatalRecovery(input: FatalErrorInput): RecoveryAction {
  if (input.kind === "media") {
    return input.mediaRecoveries < 1
      ? { action: "recover_media" }
      : { action: "fail", mediaErrorCode: 3 };
  }
  if (input.kind === "other") return { action: "fail", mediaErrorCode: 4 };
  const status = input.httpStatus ?? 0;
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return { action: "fail", mediaErrorCode: 2 };
  }
  if (!input.online) return { action: "wait_online" };
  const delayMs = NETWORK_RETRY_DELAYS_MS[input.networkRetries];
  return delayMs === undefined
    ? { action: "fail", mediaErrorCode: 2 }
    : { action: "retry", delayMs };
}

export type WatchdogInput = {
  online: boolean;
  /** The watchdog already re-attached once in this activation. */
  reattached: boolean;
  /** The viewer paused, or a play gate waits for a tap: nothing is wrong. */
  waitingForViewer: boolean;
};

export type WatchdogAction = "ignore" | "wait_online" | "reattach" | "fail";

export function decideWatchdog(input: WatchdogInput): WatchdogAction {
  if (input.waitingForViewer) return "ignore";
  if (!input.online) return "wait_online";
  return input.reattached ? "fail" : "reattach";
}

/**
 * Where playback continues after a re-attach. A few tenths before the stall
 * point, so the frame the viewer last saw is not skipped; never negative.
 */
export function reattachPosition(currentTimeSeconds: number): number | null {
  if (!Number.isFinite(currentTimeSeconds) || currentTimeSeconds <= 0.5) return null;
  return Math.max(0, currentTimeSeconds - 0.25);
}

/**
 * Where a requested seek lands (PB-2): a position inside the episode, never
 * past its last 5%, or null when the request is empty.
 */
export function seekTarget(seekToMs: number | null | undefined, durationSeconds: number): number | null {
  if (seekToMs == null || !Number.isFinite(seekToMs) || seekToMs <= 0) return null;
  const seconds = seekToMs / 1000;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return seconds;
  return Math.min(seconds, durationSeconds * 0.95);
}

/** HAVE_METADATA: duration and dimensions known, currentTime can be set. */
export const HAVE_METADATA = 1;

/** A play() refused because sound needs a gesture, on a video that has sound on. */
export function shouldFallBackToMuted(error: unknown, videoMuted: boolean): boolean {
  return !videoMuted && isNotAllowed(error);
}

export function isNotAllowed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "NotAllowedError"
  );
}

export function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
