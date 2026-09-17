import type { CaptionTrack } from "@project-flow/feed-domain";
import type Hls from "hls.js";
import { useEffect, useRef, type ReactElement, type VideoHTMLAttributes } from "react";

import {
  chooseHlsEngine,
  isHlsSource,
  isSafariUserAgent,
  planHlsLoad,
  shouldWarmHlsEngine,
  startQuality,
} from "./hlsSupport";
import {
  HAVE_METADATA,
  NO_PROGRESS_WATCHDOG_MS,
  decideFatalRecovery,
  decideWatchdog,
  isAbort,
  isNotAllowed,
  reattachPosition,
  recoveryConfirmed,
  seekTarget,
  shouldFallBackToMuted,
  type FatalKind,
} from "./playbackRecovery";
import type { PlayerAdapterEvents, PlayingInfo, VideoSource } from "./types";

export type Html5PlayerAdapterProps = {
  source: VideoSource;
  active: boolean;
  muted: boolean;
  seekToMs?: number | null;
  preload?: "none" | "metadata" | "auto";
  captionTracks: CaptionTrack[];
  events: PlayerAdapterEvents;
};

type HlsModule = typeof import("hls.js");

/** One shared download of hls.js; a failed download may be retried. */
let hlsModulePromise: Promise<HlsModule> | null = null;
function loadHls(): Promise<HlsModule> {
  hlsModulePromise ??= import("hls.js/light").catch((error: unknown) => {
    hlsModulePromise = null;
    throw error;
  });
  return hlsModulePromise;
}

// Start the hls.js download as soon as this module runs, in parallel with
// hydration, instead of after it inside the player's effect (speed-4). Only
// where hls.js will play: Safari keeps its native engine and downloads nothing.
if (
  typeof window !== "undefined" &&
  shouldWarmHlsEngine({
    isSafari: isSafariUserAgent(navigator.userAgent),
    mediaSourceSupported:
      "MediaSource" in window || "ManagedMediaSource" in window,
  })
) {
  loadHls().catch(() => {
    // The player reports it when it actually needs the engine.
  });
}

type NetworkInformationLike = { downlink?: number; saveData?: boolean };

function networkHints(): { downlinkMbps?: number; saveData?: boolean } {
  if (typeof navigator === "undefined") return {};
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike })
    .connection;
  return { downlinkMbps: connection?.downlink, saveData: connection?.saveData };
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** A pause this soon after a (re)attach comes from the reset, not the viewer. */
const ATTACH_PAUSE_GRACE_MS = 1_000;
/** requestVideoFrameCallback can stay silent (hidden tab): do not wait longer. */
const FRAME_CALLBACK_TIMEOUT_MS = 1_000;

/**
 * HTML5 adapter — avoids remount on every render; listeners attached once.
 * Muted autoplay when active; visibility pause. Adaptive (HLS) sources play
 * through hls.js, or natively on Safari.
 *
 * Every activation ends playing, at a play gate, or in onError (DECISIONI.md
 * decision 2): network failures are retried with backoff, a source that died
 * while the slide was warming is attached again when it becomes active, the
 * browser coming back online re-attaches a stuck source, and a watchdog
 * catches an active episode that makes no progress.
 */
export function Html5PlayerAdapter({
  source,
  active,
  muted,
  seekToMs = null,
  preload = "auto",
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
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const loadStartedRef = useRef(false);
  /** `playing` already reported since the last pause or activation. */
  const playEmittedRef = useRef(false);
  /** The first frame of this activation was reported. */
  const firstFrameRef = useRef(false);
  const attemptEmittedRef = useRef(false);
  const bufferingRef = useRef(false);
  const lastUriRef = useRef<string | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsSegmentsStartedRef = useRef(false);
  const sourceGenerationRef = useRef(0);

  /** A requested seek not applied yet (PB-2). Cleared once applied or withdrawn. */
  const pendingSeekMsRef = useRef<number | null>(null);
  /** Where a re-attached source continues, in seconds. */
  const startAtRef = useRef<number | null>(null);

  /** The source failed and nothing is retrying it: attach again before playing. */
  const deadRef = useRef(false);
  /** Stuck because the browser is offline; the `online` event re-attaches. */
  const waitingOnlineRef = useRef(false);
  const networkRetriesRef = useRef(0);
  const mediaRecoveriesRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const watchdogTimerRef = useRef<number | null>(null);
  const watchdogReattachedRef = useRef(false);
  /** Position (s) a retry or watchdog re-attach continued from, until playback proves it. */
  const recoveredFromRef = useRef<number | null>(null);
  const lastProgressAtRef = useRef(0);
  const attachedAtRef = useRef(0);
  /** Autoplay refused: a play gate waits for a tap. */
  const gateRef = useRef(false);
  /** The viewer paused the active episode. */
  const userPausedRef = useRef(false);

  function markProgress() {
    lastProgressAtRef.current = Date.now();
  }

  function clearWatchdog() {
    if (watchdogTimerRef.current !== null) window.clearTimeout(watchdogTimerRef.current);
    watchdogTimerRef.current = null;
  }

  /** Watches the active episode: no frame and no loaded media for too long. */
  function armWatchdog() {
    if (!activeRef.current) return;
    clearWatchdog();
    markProgress();
    watchdogTimerRef.current = window.setTimeout(onWatchdog, NO_PROGRESS_WATCHDOG_MS);
  }

  function onWatchdog() {
    watchdogTimerRef.current = null;
    const video = videoRef.current;
    if (!video || !activeRef.current) return;
    // Playing normally: nothing to watch until the next stall arms it again.
    if (firstFrameRef.current && !bufferingRef.current && !video.paused) return;
    const idleMs = Date.now() - lastProgressAtRef.current;
    if (idleMs < NO_PROGRESS_WATCHDOG_MS) {
      // Media is still arriving (slow network): look again later.
      watchdogTimerRef.current = window.setTimeout(onWatchdog, NO_PROGRESS_WATCHDOG_MS - idleMs);
      return;
    }
    const action = decideWatchdog({
      online: isOnline(),
      reattached: watchdogReattachedRef.current,
      waitingForViewer:
        gateRef.current ||
        video.ended ||
        document.visibilityState === "hidden" ||
        (video.paused && userPausedRef.current),
    });
    if (action === "ignore") return;
    if (action === "wait_online") {
      waitingOnlineRef.current = true;
      eventsRef.current.onNetworkWait?.();
      return;
    }
    if (action === "reattach") {
      watchdogReattachedRef.current = true;
      recoveredFromRef.current = video.currentTime;
      attachSource(reattachPosition(video.currentTime));
      void tryPlay(video);
      return;
    }
    deadRef.current = true;
    hlsRef.current?.stopLoad();
    eventsRef.current.onError?.("No playback progress", 2, true);
  }

  function clearRetryTimer() {
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }

  /** What to do with an unrecoverable-looking error from hls.js or the element. */
  function handleFatal(kind: FatalKind, httpStatus: number | null, message: string) {
    const video = videoRef.current;
    if (!video) return;
    const decision = decideFatalRecovery({
      kind,
      httpStatus,
      online: isOnline(),
      networkRetries: networkRetriesRef.current,
      mediaRecoveries: mediaRecoveriesRef.current,
    });
    if (decision.action === "recover_media") {
      mediaRecoveriesRef.current += 1;
      if (hlsRef.current) {
        hlsRef.current.recoverMediaError();
      } else {
        attachSource(reattachPosition(video.currentTime));
        if (activeRef.current) void tryPlay(video);
      }
      return;
    }
    deadRef.current = true;
    hlsRef.current?.stopLoad();
    if (decision.action === "retry") {
      networkRetriesRef.current += 1;
      const generation = sourceGenerationRef.current;
      clearRetryTimer();
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        if (generation !== sourceGenerationRef.current || videoRef.current !== video) return;
        recoveredFromRef.current = video.currentTime;
        attachSource(reattachPosition(video.currentTime));
        if (activeRef.current) void tryPlay(video);
      }, decision.delayMs);
      return;
    }
    if (decision.action === "wait_online") {
      waitingOnlineRef.current = true;
      if (activeRef.current) eventsRef.current.onNetworkWait?.();
      return;
    }
    // A slide that is only warming keeps the dead source: it is attached
    // again when it becomes active (PB-1).
    if (!activeRef.current) return;
    clearWatchdog();
    eventsRef.current.onError?.(message, decision.mediaErrorCode, decision.connection);
  }

  // Attach listeners once — prevent leaks from rebinding on active/seek changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoadStart = () => {
      if (loadStartedRef.current) return;
      loadStartedRef.current = true;
      eventsRef.current.onLoadStart?.();
    };

    const onLoadedMetadata = () => {
      markProgress();
      const startAt = startAtRef.current;
      // hls.js starts at startPosition itself; a native source seeks here.
      if (startAt !== null && !hlsRef.current) {
        startAtRef.current = null;
        video.currentTime = startAt;
      }
      applyPendingSeek(video);
    };

    const onCanPlay = () => {
      markProgress();
      eventsRef.current.onCanPlay?.();
      applyPendingSeek(video);
      if (activeRef.current && !userPausedRef.current) {
        void tryPlay(video);
      }
    };

    const onProgress = () => markProgress();

    const onTimeUpdate = () => {
      if (!activeRef.current) return;
      if (!video.paused) markProgress();
      // A recovery that really played on: the next, unrelated stall gets its
      // own retries and its own re-attach.
      const recoveredFrom = recoveredFromRef.current;
      if (recoveredFrom !== null && recoveryConfirmed(recoveredFrom, video.currentTime)) {
        recoveredFromRef.current = null;
        networkRetriesRef.current = 0;
        watchdogReattachedRef.current = false;
      }
      const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
      eventsRef.current.onTimeUpdate?.(video.currentTime * 1000, durationMs);
    };

    const onEnded = () => {
      if (!activeRef.current) return;
      clearWatchdog();
      playEmittedRef.current = false;
      eventsRef.current.onEnded?.();
    };

    const onPlay = () => {
      if (!activeRef.current) return;
      gateRef.current = false;
      userPausedRef.current = false;
      if (!firstFrameRef.current) armWatchdog();
      eventsRef.current.onPlay?.();
    };

    const onPause = () => {
      if (!activeRef.current) return;
      // Ignore pause fired while switching away — active already false.
      if (video.ended) return;
      playEmittedRef.current = false;
      if (
        document.visibilityState === "visible" &&
        Date.now() - attachedAtRef.current > ATTACH_PAUSE_GRACE_MS
      ) {
        userPausedRef.current = true;
      }
      eventsRef.current.onPause?.();
    };

    const onWaiting = () => {
      if (!activeRef.current) return;
      armWatchdog();
      // Before the first frame this is startup, not rebuffering (MP-1).
      if (!firstFrameRef.current || bufferingRef.current) return;
      bufferingRef.current = true;
      eventsRef.current.onBufferingStart?.();
    };

    const onPlaying = () => {
      markProgress();
      clearWatchdog();
      waitingOnlineRef.current = false;
      if (bufferingRef.current) {
        bufferingRef.current = false;
        eventsRef.current.onBufferingEnd?.();
      }
      if (!activeRef.current || playEmittedRef.current) return;
      playEmittedRef.current = true;
      if (firstFrameRef.current) {
        eventsRef.current.onPlaying?.({ firstFrame: false, frameSource: "playing_event" });
        return;
      }
      firstFrameRef.current = true;
      const generation = sourceGenerationRef.current;
      whenFrameShown(video, (frameSource) => {
        if (!activeRef.current || generation !== sourceGenerationRef.current) return;
        const info: PlayingInfo = { firstFrame: true, frameSource };
        eventsRef.current.onPlaying?.(info);
      });
    };

    const onError = () => {
      // hls.js reports its own errors (see attachHls).
      if (hlsRef.current) return;
      const code = video.error?.code ?? null;
      const kind: FatalKind = code === 2 ? "network" : code === 3 ? "media" : "other";
      handleFatal(kind, null, video.error?.message ?? "Video playback failed");
    };

    video.addEventListener("loadstart", onLoadStart);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("progress", onProgress);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);

    return () => {
      video.removeEventListener("loadstart", onLoadStart);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("progress", onProgress);
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

  /**
   * (Re)attaches the current source. `startAt` continues from a position
   * (after a failure); null starts where the episode starts.
   */
  function attachSource(startAt: number | null) {
    const video = videoRef.current;
    if (!video) return;
    const current = sourceRef.current;
    const generation = ++sourceGenerationRef.current;
    clearRetryTimer();
    destroyHls();
    deadRef.current = false;
    waitingOnlineRef.current = false;
    startAtRef.current = startAt;
    attachedAtRef.current = Date.now();
    markProgress();
    video.poster = current.poster ?? "";

    if (!isHlsSource(current.mimeType ?? "", current.uri)) {
      video.src = current.uri;
      video.load();
      return;
    }

    const canPlayNativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "";
    const isSafari =
      typeof navigator !== "undefined" && isSafariUserAgent(navigator.userAgent);

    if (canPlayNativeHls && isSafari) {
      video.src = current.uri;
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
          video.src = current.uri;
          video.load();
          return;
        }
        if (engine === "unsupported") {
          deadRef.current = true;
          if (activeRef.current) {
            eventsRef.current.onError?.("Adaptive video is not supported here", 4, false);
          }
          return;
        }
        attachHls(HlsClass, video, current.uri);
      })
      .catch(() => {
        if (generation !== sourceGenerationRef.current) return;
        // The player code could not be downloaded: a network problem.
        handleFatal("network", null, "Video engine failed to load");
      });
  }

  // Source change without React remount (no key churn).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (lastUriRef.current === source.uri) return;
    lastUriRef.current = source.uri;
    loadStartedRef.current = false;
    playEmittedRef.current = false;
    firstFrameRef.current = false;
    attemptEmittedRef.current = false;
    bufferingRef.current = false;
    networkRetriesRef.current = 0;
    mediaRecoveriesRef.current = 0;
    recoveredFromRef.current = null;
    attachSource(null);
  }, [source.uri, source.poster, source.contentId, source.mimeType]);

  function attachHls(HlsClass: HlsModule["default"], video: HTMLVideoElement, uri: string) {
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

    hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
      if (hlsRef.current !== hls) return;
      markProgress();
      if (quality.capToLowest) hls.autoLevelCapping = 0;
      applyHlsPlan();
    });
    hls.on(HlsClass.Events.FRAG_LOADED, () => markProgress());
    hls.on(HlsClass.Events.LEVEL_LOADED, () => markProgress());
    hls.on(HlsClass.Events.ERROR, (_event, data) => {
      if (hlsRef.current !== hls || !data.fatal) return;
      const kind: FatalKind =
        data.type === HlsClass.ErrorTypes.NETWORK_ERROR
          ? "network"
          : data.type === HlsClass.ErrorTypes.MEDIA_ERROR
            ? "media"
            : "other";
      handleFatal(kind, data.response?.code ?? null, data.details);
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
      const startAt = startAtRef.current;
      startAtRef.current = null;
      hls.startLoad(startAt ?? -1);
    }
  }

  function destroyHls() {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    hlsSegmentsStartedRef.current = false;
  }

  /** Applies a requested seek as soon as the video knows its duration (PB-2). */
  function applyPendingSeek(video: HTMLVideoElement) {
    const requested = pendingSeekMsRef.current;
    if (requested === null || video.readyState < HAVE_METADATA) return;
    pendingSeekMsRef.current = null;
    const target = seekTarget(requested, video.duration);
    if (target !== null) video.currentTime = target;
    eventsRef.current.onSeekApplied?.();
  }

  // Tear down the adaptive engine and the timers with the component.
  useEffect(
    () => () => {
      sourceGenerationRef.current += 1;
      clearRetryTimer();
      clearWatchdog();
      destroyHls();
    },
    [],
  );

  // A seek request applies now when it can, otherwise at loadedmetadata or
  // canplay. A withdrawn request (null) can never fire later.
  useEffect(() => {
    const video = videoRef.current;
    pendingSeekMsRef.current = seekToMs != null && seekToMs > 0 ? seekToMs : null;
    if (video) applyPendingSeek(video);
  }, [seekToMs]);

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

  // The browser never draws cues itself: native cues land under the bottom
  // scrim and the title (A11Y-01). Tracks stay "hidden", which still loads
  // them and keeps activeCues current, and the app renders the text.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const list = video.textTracks;
    const watched = new Set<TextTrack>();
    const report = (track: TextTrack) => {
      if (track.mode === "disabled") return;
      const cues = track.activeCues;
      const payloads: string[] = [];
      if (cues) {
        for (let i = 0; i < cues.length; i += 1) {
          const cue = cues[i] as (TextTrackCue & { text?: string }) | undefined;
          if (cue && typeof cue.text === "string") payloads.push(cue.text);
        }
      }
      eventsRef.current.onCueChange?.(payloads);
    };
    const onCueChange = (event: Event) => report(event.target as TextTrack);
    const watch = () => {
      for (let i = 0; i < list.length; i += 1) {
        const track = list[i];
        if (!track || watched.has(track)) continue;
        track.mode = "hidden";
        watched.add(track);
        track.addEventListener("cuechange", onCueChange);
        report(track);
      }
    };
    watch();
    list.addEventListener("addtrack", watch);
    return () => {
      list.removeEventListener("addtrack", watch);
      for (const track of watched) track.removeEventListener("cuechange", onCueChange);
    };
  }, [captionTracks, source.contentId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      firstFrameRef.current = false;
      playEmittedRef.current = false;
      userPausedRef.current = false;
      gateRef.current = false;
      networkRetriesRef.current = 0;
      watchdogReattachedRef.current = false;
      recoveredFromRef.current = null;
      // Died while warming (or before a previous error): attach a fresh one.
      if (deadRef.current || waitingOnlineRef.current) {
        attachSource(reattachPosition(video.currentTime));
      } else {
        applyHlsPlan();
      }
      void tryPlay(video);
    } else {
      applyHlsPlan();
      clearWatchdog();
      video.pause();
      playEmittedRef.current = false;
      attemptEmittedRef.current = false;
      bufferingRef.current = false;
    }
  }, [active]);

  // Browser tab visibility — pause when hidden; resume attempt when visible + active.
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.visibilityState === "hidden") {
        clearWatchdog();
        video.pause();
      } else if (activeRef.current && !userPausedRef.current) {
        void tryPlay(video);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Back online: a source that died or stalled meanwhile is attached again.
  useEffect(() => {
    const onOnline = () => {
      const video = videoRef.current;
      if (!video) return;
      const stuck =
        deadRef.current ||
        waitingOnlineRef.current ||
        (activeRef.current && !gateRef.current && (bufferingRef.current || !firstFrameRef.current));
      if (!stuck) return;
      if (!activeRef.current && preloadRef.current === "none") return;
      networkRetriesRef.current = 0;
      watchdogReattachedRef.current = false;
      attachSource(reattachPosition(video.currentTime));
      if (activeRef.current) void tryPlay(video);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  async function tryPlay(video: HTMLVideoElement): Promise<void> {
    if (!attemptEmittedRef.current) {
      attemptEmittedRef.current = true;
      eventsRef.current.onPlayAttempt?.();
    }
    armWatchdog();
    try {
      await video.play();
    } catch (error) {
      // AbortError = a new load interrupted this play() (e.g. hls.js attaching
      // its media source); canplay will try again. Only a refusal is a block.
      if (isAbort(error)) return;
      if (shouldFallBackToMuted(error, video.muted)) {
        // Sound needs a gesture: play muted rather than not at all (PB-3).
        video.muted = true;
        eventsRef.current.onMutedFallback?.();
        try {
          await video.play();
          return;
        } catch (retryError) {
          if (isAbort(retryError)) return;
          if (!isNotAllowed(retryError)) return;
        }
      } else if (!isNotAllowed(error)) {
        // Not a refusal (e.g. no source yet): the watchdog and error paths decide.
        return;
      }
      if (!activeRef.current) return;
      gateRef.current = true;
      clearWatchdog();
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
          />
        ))}
    </video>
  );
}

/**
 * Calls back when the first frame reaches the screen: requestVideoFrameCallback
 * where it exists, the `playing` event otherwise (MP-1).
 */
function whenFrameShown(
  video: HTMLVideoElement,
  callback: (frameSource: PlayingInfo["frameSource"]) => void,
) {
  if (typeof video.requestVideoFrameCallback !== "function") {
    callback("playing_event");
    return;
  }
  let done = false;
  const fallback = window.setTimeout(() => {
    if (done) return;
    done = true;
    callback("playing_event");
  }, FRAME_CALLBACK_TIMEOUT_MS);
  video.requestVideoFrameCallback(() => {
    if (done) return;
    done = true;
    window.clearTimeout(fallback);
    callback("video_frame");
  });
}
