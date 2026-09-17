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
import type { ProgressStore } from "./progressStore";
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
  onToggleMute: () => void;
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
  /** The active episode cannot play. The feed skips it after a readable delay. */
  onError: (item: ContentItem, code: string, reason: string) => void;
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
  active: boolean;
  preload: "none" | "metadata" | "auto";
  muted: boolean;
  captionsOn: boolean;
  liked: boolean;
  following: boolean;
  seekToMs: number | null;
  showPlayGate: boolean;
  locale?: string | null | undefined;
  progressStore: ProgressStore;
  handlers: FeedItemHandlers;
};

function FeedItemViewImpl({
  item,
  active,
  preload,
  muted,
  captionsOn,
  liked,
  following,
  seekToMs,
  showPlayGate,
  locale,
  progressStore,
  handlers,
}: FeedItemViewProps): ReactElement {
  const [playing, setPlaying] = useState(false);
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
    handlers.onError(item, resolved.error.code, resolved.error.reason);
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

  /** A failed but resolvable episode gets a fresh player (PB-5). */
  const retryIfFailed = () => {
    setOffline(false);
    if (!failedRef.current || !resolvableRef.current) return;
    setFailed(false);
    setPlaying(false);
    setAttempt((count) => count + 1);
  };

  // Coming back to a failed episode tries it again.
  const wasActive = useRef(active);
  useEffect(() => {
    const becameActive = active && !wasActive.current;
    wasActive.current = active;
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
    setFailed(false);
    setAttempt((count) => count + 1);
  };

  return (
    <article
      className={`${styles.slide}${active ? ` ${styles.slideActive}` : ""}`}
      data-content-id={item.id}
      data-active={active ? "true" : undefined}
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
            captionsOn={captionsOn && item.captionsAvailable}
            captionTracks={tracks}
            events={{
              onLoadStart: () => handlers.onLoadStart(item),
              onCanPlay: () => handlers.onCanPlay(item),
              onTimeUpdate: (positionMs, durationMs) =>
                handlers.onTimeUpdate(item, positionMs, durationMs),
              onEnded: () => {
                setPlaying(false);
                handlers.onEnded(item);
              },
              onError: (_message, mediaCode) => {
                if (!active) return;
                const classified = classifyMediaError(mediaCode);
                setFailed(true);
                setPlaying(false);
                handlers.onError(item, classified.code, classified.reason);
              },
              onPlay: () => handlers.onPlay(item),
              onPlaying: (info) => {
                // The poster leaves when a frame is on screen, not at play().
                setPlaying(true);
                setFailed(false);
                setOffline(false);
                handlers.onPlaying(item, info);
              },
              onPause: () => {
                setPlaying(false);
                handlers.onPause(item);
              },
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
        progressStore={progressStore}
        active={active}
      />

      {active && failed ? (
        <div className={styles.mediaFail} role="status">
          <p className={styles.mediaFailText}>
            This episode couldn’t play. Moving to the next one…
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
          onMute={handlers.onToggleMute}
          onCaptions={handlers.onToggleCaptions}
          onTune={handlers.onTune}
        />
      ) : null}

      <PlayGate visible={active && showPlayGate && !failed} onPlay={handlers.onPlayGate} />
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
  return (
    <div className={styles.slide} data-content-id={contentId} aria-hidden="true" />
  );
});
