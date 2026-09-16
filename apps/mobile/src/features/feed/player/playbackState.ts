export type PlaybackState =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "buffering"
  | "completed"
  | "error";

export type PlaybackEvent =
  | { type: "LOAD" }
  | { type: "READY" }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "BUFFER_START" }
  | { type: "BUFFER_END" }
  | { type: "COMPLETE" }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

export function reducePlaybackState(
  state: PlaybackState,
  event: PlaybackEvent,
): PlaybackState {
  switch (event.type) {
    case "RESET":
      return "idle";
    case "LOAD":
      return "loading";
    case "READY":
      return state === "playing" ? "playing" : "ready";
    case "PLAY":
      return "playing";
    case "PAUSE":
      return state === "idle" || state === "error" ? state : "paused";
    case "BUFFER_START":
      return state === "playing" || state === "ready" ? "buffering" : state;
    case "BUFFER_END":
      return state === "buffering" ? "playing" : state;
    case "COMPLETE":
      return "completed";
    case "ERROR":
      return "error";
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
