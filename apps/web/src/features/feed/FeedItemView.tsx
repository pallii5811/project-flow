"use client";

import {
  classifyMediaError,
  createStaticVideoProvider,
  logContentEvent,
  resolveDisplayCopy,
  selectCaptionTrack,
  type ContentItem,
} from "@project-flow/feed-domain";
import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { Html5PlayerAdapter } from "@/features/player/Html5PlayerAdapter";
import type { PlayingInfo } from "@/features/player/types";

import { ActionRail } from "./ActionRail";
import { ContentOverlay } from "./ContentOverlay";
import { PlayGate } from "./PlayGate";
import type { FailureHold } from "./feedLogic";
import type { ProgressStore } from "./progressStore";
import { episodeAnnouncement } from "./a11y";
import { activeCueText, episodePosition } from "./storyThread";
import styles from "./feed.module.css";

const videoProvider = createStaticVideoProvider();

/**
 * What a slide can report. Every handler receives the episode, so one stable
 * object serves every slide (see createStableHandlers) and memoized slides do
 * not re-render because a parent created new closures.
 */
export type FeedItemHandlers = {
  onPlayGate: () => void;
  onLike: (item: ContentItem) => void;
  onFollow: (item: ContentItem) => void;
  onShare: (item: ContentItem) => void;
  onToggleMute: (source: "rail" | "key") => void;
  /** The first tap on the picture while muted turns the sound on. */
  onUnmute: () => void;
  onToggleCaptions: () => void;
  onTune: () => void;
  onTogglePlayPause: () => void;
  onCanPlay: (item: ContentItem) => void;
  onLoadStart: (item: ContentItem) => void;
  onPosterVisible: (item: ContentItem) => void;
  onMetadataReady: (item: ContentItem) => void;
  onTimeUpdate: (item: ContentItem, positionMs: number, durationMs: number) => void;
  onEnded: (item: ContentItem) => void;
  /**
   * The active episode cannot play. The feed skips it after a readable delay.
   * `connection`: the network or the no-progress watchdog failed, not the episode.
   */
  onError: (item: ContentItem, code: string, reason: string, connection: boolean) => void;
  /** The viewer asked to try a failed episode again. */
  onRetry: (item: ContentItem) => void;
  onPlay: (item: ContentItem) => void;
  onPlaying: (item: ContentItem, info: PlayingInfo) => void;
  onPause: (item: ContentItem) => void;
  onPlayAttempt: (item: ContentItem) => void;
  onAutoplayBlocked: () => void;
  onMutedFallback: (item: ContentItem) => void;
  onSeekApplied: (item: ContentItem) => void;
  onBufferingStart: (item: ContentItem) => void;
  onBufferingEnd: (item: ContentItem) => void;
};

type FeedItemViewProps = {
  item: ContentItem;
  /** 1-based place in the feed list, for aria-posinset. */
  position: number;
  active: boolean;
  preload: "none" | "metadata" | "auto";
  muted: boolean;
  /** Captions on screen (the viewer's choice, or on while muted). */
  captionsOn: boolean;
  /** Episodes in the series, for "Episode 3 / 60"; null when unknown. */
  episodeCount: number | null;
  /** The Continue strip covers the title block: captions move above it. */
  overlayCovered?: boolean;
  liked: boolean;
  following: boolean;
  seekToMs: number | null;
  showPlayGate: boolean;
  /** Why this failed episode waits for the viewer instead of skipping. */
  failureHold?: FailureHold | null;
  locale?: string | null | undefined;
  progressStore: ProgressStore;
  handlers: FeedItemHandlers;
};

function FeedItemViewImpl({
  item,
  position,
  active,
  preload,
  muted,
  captionsOn,
  episodeCount,
  overlayCovered = false,
  liked,
  following,
  seekToMs,
  showPlayGate,
  failureHold = null,
  locale,
  progressStore,
  handlers,
}: FeedItemViewProps): ReactElement {
  const [playing, setPlaying] = useState(false);
  /** A frame of this activation reached the screen: a later pause is a real pause. */
  const [hasPlayed, setHasPlayed] = useState(false);
  /** The viewer paused: a play glyph confirms it. */
  const [viewerPaused, setViewerPaused] = useState(false);
  /** Dialogue on screen now, as plain text; null between cues. */
  const [cueText, setCueText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** Stuck because the browser is offline; clears when playback resumes. */
  const [offline, setOffline] = useState(false);
  /** Bumped to mount a fresh player after a failure (PB-5). */
  const [attempt, setAttempt] = useState(0);

  // Checked against the clock each time the slide becomes active: rights can
  // expire during a session.
  const resolved = useMemo(() => {
    void active; // resolved again at each activation, against the current clock
    return videoProvider.resolve(item.playback);
  }, [item.playback, active]);

  const display = useMemo(() => resolveDisplayCopy(item, locale), [item, locale]);

  const captionTrack = useMemo(
    () => selectCaptionTrack(item.captions, locale ?? item.language),
    [item.captions, item.language, locale],
  );

  const tracks = useMemo(() => {
    if (!captionTrack) return [];
    return [captionTrack];
  }, [captionTrack]);

  useEffect(() => {
    handlers.onMetadataReady(item);
    if (resolved.ok) {
      logContentEvent({
        event: "playback_resolved",
        contentId: item.id,
        seriesId: item.seriesId,
      });
    }
    // Once per episode: item identity follows item.id.
  }, [item.id]);

  // An episode that cannot even resolve fails only when the viewer is on it:
  // a neighbour warming up must never move the feed (PB-4, R3).
  useEffect(() => {
    if (!active || resolved.ok) return;
    setFailed(true);
    handlers.onError(item, resolved.error.code, resolved.error.reason, false);
    logContentEvent({
      event: "playback_failed",
      contentId: item.id,
      code: resolved.error.code,
      detail: resolved.error.reason,
    });
  }, [active, resolved]);

  const failedRef = useRef(failed);
  failedRef.current = failed;
  const resolvableRef = useRef(resolved.ok);
  resolvableRef.current = resolved.ok;
  const itemRef = useRef(item);
  itemRef.current = item;

  /**
   * A failed but resolvable episode gets a fresh player (PB-5). The feed is
   * told, as for Try again, so its pending skip cannot fire on the new try.
   */
  const retryIfFailed = () => {
    setOffline(false);
    if (!failedRef.current || !resolvableRef.current) return;
    handlers.onRetry(itemRef.current);
    setFailed(false);
    setPlaying(false);
    setHasPlayed(false);
    setAttempt((count) => count + 1);
  };

  // Coming back to a failed episode tries it again. Every activation starts
  // on the poster until its own first frame, and without a pause glyph.
  const wasActive = useRef(active);
  useEffect(() => {
    const becameActive = active && !wasActive.current;
    wasActive.current = active;
    setViewerPaused(false);
    if (!active) setHasPlayed(false);
    if (becameActive) retryIfFailed();
  }, [active]);

  // The network is back: a failed episode gets another chance.
  useEffect(() => {
    window.addEventListener("online", retryIfFailed);
    return () => window.removeEventListener("online", retryIfFailed);
  }, []);

  const showPoster = !playing || failed || !active;
  const playableUrl = resolved.ok ? resolved.playback.url : "";
  const posterUrl = resolved.ok ? resolved.playback.posterUrl : item.thumbnailUrl;
  const mountPlayer = resolved.ok && !failed && (active || preload !== "none");

  /** First tap while muted = unmute (emotional hit). Later taps = play/pause. */
  const handleSurfaceTap = () => {
    if (!active || failed || showPlayGate) return;
    if (muted) {
      handlers.onUnmute();
      return;
    }
    handlers.onTogglePlayPause();
  };

  const handleRetry = () => {
    handlers.onRetry(item);
    setOffline(false);
    setPlaying(false);
    setHasPlayed(false);
    setFailed(false);
    setAttempt((count) => count + 1);
  };

  return (
    <article
      className={`${styles.slide}${active ? ` ${styles.slideActive}` : ""}`}
      data-content-id={item.id}
      data-active={active ? "true" : undefined}
      // Named for screen readers; the feed grows, so its size is unknown (A11Y-07).
      aria-label={episodeAnnouncement(
        item.seriesTitle,
        episodePosition(item.episodeNumber, episodeCount).label,
      )}
      aria-posinset={position}
      aria-setsize={-1}
      tabIndex={-1}
    >
      <div className={styles.media}>
        <img
          className={`${styles.poster}${showPoster ? "" : ` ${styles.posterHidden}`}`}
          src={posterUrl}
          alt=""
          draggable={false}
          // Safety net: a neighbour's poster waits until it is near the screen.
          loading={active ? "eager" : "lazy"}
          decoding={active ? "sync" : "async"}
          fetchPriority={active ? "high" : "low"}
          onLoad={() => {
            if (active) handlers.onPosterVisible(item);
          }}
          onError={() => {
            if (active) {
              logContentEvent({
                event: "playback_failed",
                contentId: item.id,
                code: "MISSING_SOURCE",
                detail: "poster",
              });
            }
          }}
        />
        {mountPlayer ? (
          <Html5PlayerAdapter
            key={attempt}
            source={{
              uri: playableUrl,
              poster: posterUrl,
              contentId: item.id,
              mimeType: resolved.ok ? resolved.playback.mimeType : "",
            }}
            active={active && !failed}
            muted={muted}
            seekToMs={active ? seekToMs : null}
            preload={preload}
            captionTracks={tracks}
            events={{
              onLoadStart: () => handlers.onLoadStart(item),
              onCanPlay: () => handlers.onCanPlay(item),
              onTimeUpdate: (positionMs, durationMs) =>
                handlers.onTimeUpdate(item, positionMs, durationMs),
              onEnded: () => {
                setPlaying(false);
                setViewerPaused(false);
                handlers.onEnded(item);
              },
              onError: (_message, mediaCode, connection) => {
                if (!active) return;
                const classified = classifyMediaError(mediaCode);
                setFailed(true);
                setPlaying(false);
                handlers.onError(
                  item,
                  classified.code,
                  classified.reason,
                  connection === true,
                );
              },
              onPlay: () => handlers.onPlay(item),
              onPlaying: (info) => {
                // The poster leaves when a frame is on screen, not at play().
                setPlaying(true);
                setHasPlayed(true);
                setViewerPaused(false);
                setFailed(false);
                setOffline(false);
                handlers.onPlaying(item, info);
              },
              onPause: () => {
                setPlaying(false);
                // A hidden tab pauses too; only a pause the viewer can see is theirs.
                if (active && document.visibilityState === "visible")
                  setViewerPaused(true);
                handlers.onPause(item);
              },
              onCueChange: (payloads) => setCueText(activeCueText(payloads)),
              onPlayAttempt: () => handlers.onPlayAttempt(item),
              onAutoplayBlocked: handlers.onAutoplayBlocked,
              onMutedFallback: () => handlers.onMutedFallback(item),
              onSeekApplied: () => handlers.onSeekApplied(item),
              onNetworkWait: () => {
                if (active) setOffline(true);
              },
              onBufferingStart: () => handlers.onBufferingStart(item),
              onBufferingEnd: () => handlers.onBufferingEnd(item),
            }}
          />
        ) : null}
      </div>

      {/* Hit target above media, below chrome — tap-to-unmute / play-pause */}
      {active && !failed && !showPlayGate ? (
        <button
          type="button"
          className={styles.surfaceHit}
          aria-label={muted ? "Unmute" : playing ? "Pause" : "Play"}
          onClick={handleSurfaceTap}
        />
      ) : null}

      <ContentOverlay
        key={item.id}
        contentId={item.id}
        seriesTitle={item.seriesTitle}
        hook={display.hook}
        episodeNumber={item.episodeNumber}
        episodeCount={episodeCount}
        caption={active && captionsOn && !failed ? cueText : null}
        covered={overlayCovered}
        progressStore={progressStore}
        active={active}
      />

      {active && viewerPaused && hasPlayed && !playing && !failed && !showPlayGate ? (
        <div className={styles.pausedGlyph} aria-hidden="true" data-paused-glyph="true">
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="currentColor"
            focusable="false"
          >
            <path d="M8.5 5.8v12.4L19 12 8.5 5.8z" />
          </svg>
        </div>
      ) : null}

      {active && failed ? (
        <div className={styles.mediaFail} role="status">
          <p className={styles.mediaFailText}>
            {failureHold === "connection"
              ? "Connection problem: episodes aren’t loading. Try again when your connection is back."
              : failureHold === "end"
                ? "This episode couldn’t play."
                : "This episode couldn’t play. Moving to the next one…"}
          </p>
          {resolved.ok ? (
            <button type="button" className={styles.mediaFailRetry} onClick={handleRetry}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      {active && offline && !failed ? (
        <div className={styles.mediaFail} role="status">
          <p className={styles.mediaFailText}>
            You’re offline. The episode continues when you’re back.
          </p>
        </div>
      ) : null}

      {active ? (
        <ActionRail
          liked={liked}
          following={following}
          muted={muted}
          captionsOn={captionsOn}
          captionsAvailable={item.captionsAvailable}
          onLike={() => handlers.onLike(item)}
          onFollow={() => handlers.onFollow(item)}
          onShare={() => handlers.onShare(item)}
          onMute={() => handlers.onToggleMute("rail")}
          onCaptions={handlers.onToggleCaptions}
          onTune={handlers.onTune}
        />
      ) : null}

      <PlayGate
        visible={active && showPlayGate && !failed}
        onPlay={handlers.onPlayGate}
      />
    </article>
  );
}

/**
 * Re-renders only when this slide's own data changes. Playback progress is
 * not a prop (it lives in the ProgressStore), so a playing episode no longer
 * re-renders its neighbours.
 */
export const FeedItemView = memo(FeedItemViewImpl);

/** Keeps a slide's scroll-snap point without poster, player or text. */
export const FeedSlidePlaceholder = memo(function FeedSlidePlaceholder({
  contentId,
}: {
  contentId: string;
}): ReactElement {
  return <div className={styles.slide} data-content-id={contentId} aria-hidden="true" />;
});
