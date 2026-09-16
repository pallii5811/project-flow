import type { CaptionTrack } from "@project-flow/feed-domain";
import type Hls from "hls.js";
import { useEffect, useRef, type ReactElement, type VideoHTMLAttributes } from "react";

import {
  chooseHlsEngine,
  isHlsSource,
  isSafariUserAgent,
  planHlsLoad,
  startQuality,
} from "./hlsSupport";
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

type HlsModule = typeof import("hls.js");

/** One shared download of hls.js, started by the first adaptive source. */
let hlsModulePromise: Promise<HlsModule> | null = null;
function loadHls(): Promise<HlsModule> {
  hlsModulePromise ??= import("hls.js/light");
  return hlsModulePromise;
}

type NetworkInformationLike = { downlink?: number; saveData?: boolean };

function networkHints(): { downlinkMbps?: number; saveData?: boolean } {
  if (typeof navigator === "undefined") return {};
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike })
    .connection;
  return { downlinkMbps: connection?.downlink, saveData: connection?.saveData };
}

/**
 * HTML5 adapter — avoids remount on every render; listeners attached once.
 * Muted autoplay when active; visibility pause; single retry on error.
 * Adaptive (HLS) sources play through hls.js, or natively on Safari.
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
  const preloadRef = useRef(preload);
  preloadRef.current = preload;
  const seekRef = useRef(seekToMs);
  seekRef.current = seekToMs;

  const retriedRef = useRef(false);
  const seekAppliedRef = useRef(false);
  const loadStartedRef = useRef(false);
  const playEmittedRef = useRef(false);
  const attemptEmittedRef = useRef(false);
  const bufferingRef = useRef(false);
  const lastUriRef = useRef<string | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsSegmentsStartedRef = useRef(false);
  const sourceGenerationRef = useRef(0);

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
      const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
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
      // hls.js reports its own errors (see attachHls); media element errors
      // while it is attached are handled there.
      if (hlsRef.current) return;
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
    const generation = ++sourceGenerationRef.current;
    destroyHls();
    video.poster = source.poster ?? "";

    if (!isHlsSource(source.mimeType ?? "", source.uri)) {
      video.src = source.uri;
      video.load();
      return;
    }

    const canPlayNativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "";
    const isSafari =
      typeof navigator !== "undefined" && isSafariUserAgent(navigator.userAgent);

    if (canPlayNativeHls && isSafari) {
      video.src = source.uri;
      video.load();
      return;
    }

    void loadHls()
      .then(({ default: HlsClass }) => {
        // A newer source or an unmount won the race: do nothing.
        if (generation !== sourceGenerationRef.current || videoRef.current !== video)
          return;
        const engine = chooseHlsEngine({
          canPlayNativeHls,
          mediaSourceSupported: HlsClass.isSupported(),
          isSafari,
        });
        if (engine === "native") {
          video.src = source.uri;
          video.load();
          return;
        }
        if (engine === "unsupported") {
          eventsRef.current.onError?.("Adaptive video is not supported here", 4);
          return;
        }
        attachHls(HlsClass, video, source.uri);
      })
      .catch(() => {
        if (generation !== sourceGenerationRef.current) return;
        // The player code could not be downloaded: a network problem.
        eventsRef.current.onError?.("Video engine failed to load", 2);
      });
  }, [source.uri, source.poster, source.contentId, source.mimeType]);

  function attachHls(
    HlsClass: HlsModule["default"],
    video: HTMLVideoElement,
    uri: string,
  ) {
    const plan = planHlsLoad(activeRef.current, preloadRef.current);
    const quality = startQuality(networkHints());
    const hls = new HlsClass({
      autoStartLoad: false,
      startLevel: -1,
      capLevelToPlayerSize: true,
      abrEwmaDefaultEstimate: quality.estimateBps,
      maxBufferLength: plan.targetBufferSeconds,
      maxMaxBufferLength: plan.maxBufferSeconds,
      backBufferLength: 10,
    });
    hlsRef.current = hls;
    hlsSegmentsStartedRef.current = false;

    let networkRetried = false;
    let mediaRecovered = false;

    hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
      if (quality.capToLowest) hls.autoLevelCapping = 0;
      applyHlsPlan();
    });
    hls.on(HlsClass.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR && !networkRetried) {
        networkRetried = true;
        hls.startLoad();
        return;
      }
      if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
        mediaRecovered = true;
        hls.recoverMediaError();
        return;
      }
      if (!activeRef.current) return;
      const code = data.type === HlsClass.ErrorTypes.NETWORK_ERROR ? 2 : 3;
      eventsRef.current.onError?.(data.details, code);
    });

    hls.loadSource(uri);
    hls.attachMedia(video);
  }

  /** Current fully warm, next only its first seconds, previous no media. */
  function applyHlsPlan() {
    const hls = hlsRef.current;
    if (!hls) return;
    const plan = planHlsLoad(activeRef.current, preloadRef.current);
    hls.config.maxBufferLength = plan.targetBufferSeconds;
    hls.config.maxMaxBufferLength = plan.maxBufferSeconds;
    if (plan.load === "segments" && !hlsSegmentsStartedRef.current) {
      hlsSegmentsStartedRef.current = true;
      hls.startLoad(-1);
    }
  }

  function destroyHls() {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    hlsSegmentsStartedRef.current = false;
  }

  // Tear down the adaptive engine with the component.
  useEffect(() => () => destroyHls(), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.preload = preload;
    applyHlsPlan();
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
    applyHlsPlan();
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
    } catch (error) {
      // AbortError = a new load interrupted this play() (e.g. hls.js attaching
      // its media source); canplay will try again. Only a refusal is a block.
      if (error instanceof DOMException && error.name === "AbortError") return;
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
