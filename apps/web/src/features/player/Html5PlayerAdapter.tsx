import type { CaptionTrack } from "@project-flow/feed-domain";
import {
  useEffect,
  useRef,
  type ReactElement,
  type VideoHTMLAttributes,
} from "react";

import type { PlayerAdapterEvents, VideoSource } from "./types";

export type Html5PlayerAdapterProps = {
  source: VideoSource;
  active: boolean;
  muted: boolean;
  seekToMs?: number | null;
  preload?: "none" | "metadata" | "auto";
  captionsOn: boolean;
  captionTracks: CaptionTrack[];
  events: PlayerAdapterEvents;
};

/**
 * HTML5 adapter — avoids remount on every render; listeners attached once.
 * Muted autoplay when active; visibility pause; single retry on error.
 */
export function Html5PlayerAdapter({
  source,
  active,
  muted,
  seekToMs = null,
  preload = "auto",
  captionsOn,
  captionTracks,
  events,
}: Html5PlayerAdapterProps): ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const activeRef = useRef(active);
  activeRef.current = active;
  const seekRef = useRef(seekToMs);
  seekRef.current = seekToMs;

  const retriedRef = useRef(false);
  const seekAppliedRef = useRef(false);
  const loadStartedRef = useRef(false);
  const playEmittedRef = useRef(false);
  const attemptEmittedRef = useRef(false);
  const bufferingRef = useRef(false);
  const lastUriRef = useRef<string | null>(null);

  // Attach listeners once — prevent leaks from rebinding on active/seek changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoadStart = () => {
      if (loadStartedRef.current) return;
      loadStartedRef.current = true;
      eventsRef.current.onLoadStart?.();
    };

    const onCanPlay = () => {
      eventsRef.current.onCanPlay?.();
      const seekTo = seekRef.current;
      if (
        seekTo != null &&
        seekTo > 0 &&
        !seekAppliedRef.current &&
        Number.isFinite(video.duration)
      ) {
        video.currentTime = Math.min(seekTo / 1000, video.duration * 0.95);
        seekAppliedRef.current = true;
      }
      if (activeRef.current) {
        void tryPlay(video);
      }
    };

    const onTimeUpdate = () => {
      if (!activeRef.current) return;
      const durationMs = Number.isFinite(video.duration)
        ? video.duration * 1000
        : 0;
      eventsRef.current.onTimeUpdate?.(video.currentTime * 1000, durationMs);
    };

    const onEnded = () => {
      if (!activeRef.current) return;
      playEmittedRef.current = false;
      eventsRef.current.onEnded?.();
    };

    const onPlay = () => {
      if (!activeRef.current) return;
      if (!playEmittedRef.current) {
        playEmittedRef.current = true;
        eventsRef.current.onPlay?.();
        eventsRef.current.onFirstFrameProxy?.();
      }
    };

    const onPause = () => {
      if (!activeRef.current) return;
      // Ignore pause fired while switching away — active already false.
      if (video.ended) return;
      playEmittedRef.current = false;
      eventsRef.current.onPause?.();
    };

    const onWaiting = () => {
      if (!activeRef.current || bufferingRef.current) return;
      bufferingRef.current = true;
      eventsRef.current.onBufferingStart?.();
    };

    const onPlaying = () => {
      if (!bufferingRef.current) return;
      bufferingRef.current = false;
      eventsRef.current.onBufferingEnd?.();
    };

    const onError = () => {
      if (!activeRef.current) return;
      if (!retriedRef.current) {
        retriedRef.current = true;
        video.load();
        void tryPlay(video);
        return;
      }
      eventsRef.current.onError?.(
        video.error?.message ?? "Video playback failed",
        video.error?.code ?? null,
      );
    };

    video.addEventListener("loadstart", onLoadStart);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);

    return () => {
      video.removeEventListener("loadstart", onLoadStart);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.pause();
    };
  }, []);

  // Source change without React remount (no key churn).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (lastUriRef.current === source.uri) return;
    lastUriRef.current = source.uri;
    retriedRef.current = false;
    seekAppliedRef.current = false;
    loadStartedRef.current = false;
    playEmittedRef.current = false;
    attemptEmittedRef.current = false;
    bufferingRef.current = false;
    video.poster = source.poster ?? "";
    video.src = source.uri;
    video.load();
  }, [source.uri, source.poster, source.contentId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.preload = preload;
  }, [preload]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (let i = 0; i < video.textTracks.length; i += 1) {
      const track = video.textTracks[i];
      if (!track) continue;
      track.mode = captionsOn ? "showing" : "hidden";
    }
  }, [captionsOn, captionTracks, source.contentId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      void tryPlay(video);
    } else {
      video.pause();
      playEmittedRef.current = false;
      attemptEmittedRef.current = false;
    }
  }, [active]);

  // Browser tab visibility — pause when hidden; resume attempt when visible + active.
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.visibilityState === "hidden") {
        video.pause();
      } else if (activeRef.current) {
        void tryPlay(video);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  async function tryPlay(video: HTMLVideoElement): Promise<void> {
    if (!attemptEmittedRef.current) {
      attemptEmittedRef.current = true;
      eventsRef.current.onPlayAttempt?.();
    }
    try {
      await video.play();
    } catch {
      eventsRef.current.onAutoplayBlocked?.();
    }
  }

  const videoProps: VideoHTMLAttributes<HTMLVideoElement> = {
    playsInline: true,
    muted,
    preload,
    // Same-origin /content assets — skip CORS tax on first play
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      background: "#050505",
    },
  };

  return (
    <video ref={videoRef} {...videoProps} aria-label="Drama episode">
      {captionTracks
        .filter((track) => track.status === "ready")
        .map((track) => (
          <track
            key={`${track.language}-${track.url}`}
            kind={track.kind}
            srcLang={track.language}
            src={track.url}
            label={track.language}
            default={track.default}
          />
        ))}
    </video>
  );
}
