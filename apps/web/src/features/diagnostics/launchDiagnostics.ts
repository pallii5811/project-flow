/**
 * Lightweight mutable diagnostics snapshot for DEV panel.
 * Not a product state store — observe-only.
 */

export type DiagPlaybackState =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "buffering"
  | "ended"
  | "error"
  | "autoplay_blocked";

export type LaunchDiagnosticsSnapshot = {
  contentId: string | null;
  seriesId: string | null;
  episodeId: string | null;
  contentStatus: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  posterOk: boolean | null;
  captionTracks: number;
  captionsOn: boolean;
  playerState: DiagPlaybackState;
  currentTimeMs: number;
  durationMs: number;
  bufferedEndMs: number | null;
  autoplayAttempted: boolean;
  autoplayBlocked: boolean;
  sourceUri: string | null;
  prefetchIds: string[];
  anonymousUserId: string | null;
  sessionId: string | null;
  resumePositionMs: number | null;
  pageStartTs: number | null;
  contentOpenTs: number | null;
  playAttemptTs: number | null;
  firstMeaningfulPlayTs: number | null;
  timeToFirstPlayMs: number | null;
};

const snapshot: LaunchDiagnosticsSnapshot = {
  contentId: null,
  seriesId: null,
  episodeId: null,
  contentStatus: null,
  width: null,
  height: null,
  aspectRatio: null,
  posterOk: null,
  captionTracks: 0,
  captionsOn: false,
  playerState: "idle",
  currentTimeMs: 0,
  durationMs: 0,
  bufferedEndMs: null,
  autoplayAttempted: false,
  autoplayBlocked: false,
  sourceUri: null,
  prefetchIds: [],
  anonymousUserId: null,
  sessionId: null,
  resumePositionMs: null,
  pageStartTs: null,
  contentOpenTs: null,
  playAttemptTs: null,
  firstMeaningfulPlayTs: null,
  timeToFirstPlayMs: null,
};

const listeners = new Set<() => void>();

export function patchLaunchDiagnostics(
  partial: Partial<LaunchDiagnosticsSnapshot>,
): void {
  Object.assign(snapshot, partial);
  for (const listener of listeners) listener();
}

export function getLaunchDiagnostics(): LaunchDiagnosticsSnapshot {
  return { ...snapshot };
}

export function subscribeLaunchDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
