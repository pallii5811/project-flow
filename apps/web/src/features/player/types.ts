export type VideoSource = {
  uri: string;
  poster?: string;
  contentId: string;
  /** Tells an adaptive playlist (HLS) from a single file. */
  mimeType?: string;
};

export type PlayingInfo = {
  /** The first frame of this activation, not a resume after pause. */
  firstFrame: boolean;
  /**
   * video_frame: requestVideoFrameCallback saw the frame reach the screen;
   * playing_event: the browser has no such callback, the `playing` event stands in.
   */
  frameSource: "video_frame" | "playing_event";
};

export type PlayerAdapterEvents = {
  onCanPlay?: () => void;
  onLoadStart?: () => void;
  onTimeUpdate?: (positionMs: number, durationMs: number) => void;
  onEnded?: () => void;
  /**
   * The active episode cannot play: recovery was tried and failed.
   * message is internal; mediaErrorCode maps to typed analytics. connection:
   * the network or the no-progress watchdog failed, not the episode itself.
   */
  onError?: (message: string, mediaErrorCode?: number | null, connection?: boolean) => void;
  /** HTML `play`: playback was requested and is no longer paused (no frame yet). */
  onPlay?: () => void;
  /**
   * Frames are really moving: the first frame of an activation, or playback
   * resuming after a pause. Speed metrics are measured here, never on `play`.
   */
  onPlaying?: (info: PlayingInfo) => void;
  onPause?: () => void;
  onPlayAttempt?: () => void;
  /** Autoplay was refused and a tap is needed (play gate). */
  onAutoplayBlocked?: () => void;
  /** Autoplay with sound was refused; the episode now plays muted. */
  onMutedFallback?: () => void;
  /** A requested seek reached the video: the request can be cleared. */
  onSeekApplied?: () => void;
  /** The active episode is stuck because the browser is offline; it resumes when back online. */
  onNetworkWait?: () => void;
  /** Rebuffering after the first frame; startup waiting is not rebuffering. */
  onBufferingStart?: () => void;
  onBufferingEnd?: () => void;
};

export type PlayerAdapterProps = {
  source: VideoSource;
  active: boolean;
  muted: boolean;
  seekToMs?: number | null;
  preload?: "none" | "metadata" | "auto";
  events: PlayerAdapterEvents;
};

export type PlayerHandle = {
  play: () => Promise<void>;
  pause: () => void;
  setMuted: (muted: boolean) => void;
};
