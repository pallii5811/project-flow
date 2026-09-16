/**
 * Internal episode-boundary continuum.
 * UI does not expose every state; orchestration must.
 *
 * PLAYING → ENDING → PREPARING_NEXT → TRANSITIONING → NEXT_PLAYING
 * PLAYING → ENDING → SERIES_ENDED (no next episode in series)
 * Any → FAILED (prepare/transition failure)
 */

export type EpisodeBoundaryState =
  | "playing"
  | "ending"
  | "preparing_next"
  | "transitioning"
  | "next_playing"
  | "series_ended"
  | "failed";

export type EpisodeBoundaryEvent =
  | { type: "NEAR_END" }
  | { type: "COMPLETED" }
  | { type: "NEXT_RESOLVED"; nextEpisodeId: string }
  | { type: "NO_NEXT" }
  | { type: "PREPARE_STARTED" }
  | { type: "PREPARE_READY" }
  | { type: "PREPARE_FAILED"; message: string }
  | { type: "TRANSITION_STARTED" }
  | { type: "TRANSITION_COMPLETED" }
  | { type: "RESET_PLAYING" };

export function reduceEpisodeBoundary(
  state: EpisodeBoundaryState,
  event: EpisodeBoundaryEvent,
): EpisodeBoundaryState {
  switch (event.type) {
    case "RESET_PLAYING":
      return "playing";
    case "NEAR_END":
      return state === "playing" ? "ending" : state;
    case "COMPLETED":
      if (state === "playing" || state === "ending" || state === "preparing_next") {
        return "ending";
      }
      return state;
    case "NEXT_RESOLVED":
      return state === "ending" || state === "preparing_next" || state === "playing"
        ? "preparing_next"
        : state;
    case "NO_NEXT":
      return "series_ended";
    case "PREPARE_STARTED":
      return state === "ending" || state === "preparing_next" ? "preparing_next" : state;
    case "PREPARE_READY":
      return state === "preparing_next" || state === "ending" ? "preparing_next" : state;
    case "PREPARE_FAILED":
      return "failed";
    case "TRANSITION_STARTED":
      return "transitioning";
    case "TRANSITION_COMPLETED":
      return "next_playing";
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/** Progress threshold to begin next-episode preparation. */
export const NEAR_END_RATIO = 0.85;
