export type VideoSource = {
  uri: string;
  poster?: string;
  contentId: string;
};

export type PlayerAdapterEvents = {
  onCanPlay?: () => void;
  onLoadStart?: () => void;
  onTimeUpdate?: (positionMs: number, durationMs: number) => void;
  onEnded?: () => void;
  /** message is internal; mediaErrorCode maps to typed analytics. */
  onError?: (message: string, mediaErrorCode?: number | null) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onPlayAttempt?: () => void;
  /** Proxy for first frame — HTMLMediaElement `play` event (not decoded-frame exact). */
  onFirstFrameProxy?: () => void;
  onAutoplayBlocked?: () => void;
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
