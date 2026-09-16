"use client";

import {
  classifyMediaError,
  createStaticVideoProvider,
  logContentEvent,
  resolveDisplayCopy,
  selectCaptionTrack,
  type ContentItem,
} from "@project-flow/feed-domain";
import { memo, useEffect, useMemo, useState, type ReactElement } from "react";

import { Html5PlayerAdapter } from "@/features/player/Html5PlayerAdapter";

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
  onError: (item: ContentItem, code: string, reason: string) => void;
  onPlay: (item: ContentItem) => void;
  onPause: (item: ContentItem) => void;
  onPlayAttempt: (item: ContentItem) => void;
  onFirstFrameProxy: (item: ContentItem) => void;
  onAutoplayBlocked: () => void;
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

  const resolved = useMemo(() => videoProvider.resolve(item.playback), [item.playback]);

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
    setPlaying(false);
    setFailed(false);
    handlers.onMetadataReady(item);
    if (resolved.ok) {
      logContentEvent({
        event: "playback_resolved",
        contentId: item.id,
        seriesId: item.seriesId,
      });
      return;
    }
    setFailed(true);
    handlers.onError(item, resolved.error.code, resolved.error.reason);
    logContentEvent({
      event: "playback_failed",
      contentId: item.id,
      code: resolved.error.code,
      detail: resolved.error.reason,
    });
    // Once per episode, as before: item identity follows item.id.
  }, [item.id, item.seriesId, resolved]);

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
              onPlay: () => {
                setPlaying(true);
                setFailed(false);
                handlers.onPlay(item);
              },
              onPause: () => {
                setPlaying(false);
                handlers.onPause(item);
              },
              onPlayAttempt: () => handlers.onPlayAttempt(item),
              onFirstFrameProxy: () => handlers.onFirstFrameProxy(item),
              onAutoplayBlocked: handlers.onAutoplayBlocked,
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
            This episode couldn’t play. Swipe for the next story.
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
