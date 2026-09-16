"use client";

import {
  classifyMediaError,
  createStaticVideoProvider,
  logContentEvent,
  resolveDisplayCopy,
  selectCaptionTrack,
  type ContentItem,
} from "@project-flow/feed-domain";
import { useEffect, useMemo, useState, type ReactElement } from "react";

import { Html5PlayerAdapter } from "@/features/player/Html5PlayerAdapter";

import { ActionRail } from "./ActionRail";
import { ContentOverlay } from "./ContentOverlay";
import { PlayGate } from "./PlayGate";
import styles from "./feed.module.css";

const videoProvider = createStaticVideoProvider();

type FeedItemViewProps = {
  item: ContentItem;
  active: boolean;
  preload: "none" | "metadata" | "auto";
  muted: boolean;
  captionsOn: boolean;
  liked: boolean;
  following: boolean;
  progress: number;
  seekToMs: number | null;
  showPlayGate: boolean;
  locale?: string | null;
  onPlayGate: () => void;
  onLike: () => void;
  onFollow: () => void;
  onShare: () => void;
  onMute: () => void;
  onUnmute: () => void;
  onCaptions: () => void;
  onTune: () => void;
  onTogglePlayPause: () => void;
  onCanPlay: () => void;
  onLoadStart: () => void;
  onPosterVisible: () => void;
  onMetadataReady: () => void;
  onTimeUpdate: (positionMs: number, durationMs: number) => void;
  onEnded: () => void;
  onError: (code: string, reason: string) => void;
  onPlay: () => void;
  onPause: () => void;
  onPlayAttempt: () => void;
  onFirstFrameProxy: () => void;
  onAutoplayBlocked: () => void;
  onBufferingStart: () => void;
  onBufferingEnd: () => void;
};

export function FeedItemView({
  item,
  active,
  preload,
  muted,
  captionsOn,
  liked,
  following,
  progress,
  seekToMs,
  showPlayGate,
  locale,
  onPlayGate,
  onLike,
  onFollow,
  onShare,
  onMute,
  onUnmute,
  onCaptions,
  onTune,
  onTogglePlayPause,
  onCanPlay,
  onLoadStart,
  onPosterVisible,
  onMetadataReady,
  onTimeUpdate,
  onEnded,
  onError,
  onPlay,
  onPause,
  onPlayAttempt,
  onFirstFrameProxy,
  onAutoplayBlocked,
  onBufferingStart,
  onBufferingEnd,
}: FeedItemViewProps): ReactElement {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  const resolved = useMemo(
    () => videoProvider.resolve(item.playback),
    [item.playback],
  );

  const display = useMemo(
    () => resolveDisplayCopy(item, locale),
    [item, locale],
  );

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
    onMetadataReady();
    if (resolved.ok) {
      logContentEvent({
        event: "playback_resolved",
        contentId: item.id,
        seriesId: item.seriesId,
      });
      return;
    }
    setFailed(true);
    onError(resolved.error.code, resolved.error.reason);
    logContentEvent({
      event: "playback_failed",
      contentId: item.id,
      code: resolved.error.code,
      detail: resolved.error.reason,
    });
  }, [item.id, item.seriesId, resolved]);

  const showPoster = !playing || failed || !active;
  const playableUrl = resolved.ok ? resolved.playback.url : "";
  const posterUrl = resolved.ok
    ? resolved.playback.posterUrl
    : item.thumbnailUrl;
  const mountPlayer = resolved.ok && !failed && (active || preload !== "none");

  /** First tap while muted = unmute (emotional hit). Later taps = play/pause. */
  const handleSurfaceTap = () => {
    if (!active || failed || showPlayGate) return;
    if (muted) {
      onUnmute();
      return;
    }
    onTogglePlayPause();
  };

  return (
    <article
      className={`${styles.slide}${active ? ` ${styles.slideActive}` : ""}`}
      data-content-id={item.id}
    >
      <div className={styles.media}>
        <img
          className={`${styles.poster}${showPoster ? "" : ` ${styles.posterHidden}`}`}
          src={posterUrl}
          alt=""
          draggable={false}
          decoding={active ? "sync" : "async"}
          fetchPriority={active ? "high" : "low"}
          onLoad={() => {
            if (active) onPosterVisible();
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
            }}
            active={active && !failed}
            muted={muted}
            seekToMs={active ? seekToMs : null}
            preload={preload}
            captionsOn={captionsOn && item.captionsAvailable}
            captionTracks={tracks}
            events={{
              onLoadStart,
              onCanPlay,
              onTimeUpdate,
              onEnded: () => {
                setPlaying(false);
                onEnded();
              },
              onError: (_message, mediaCode) => {
                if (!active) return;
                const classified = classifyMediaError(mediaCode);
                setFailed(true);
                setPlaying(false);
                onError(classified.code, classified.reason);
              },
              onPlay: () => {
                setPlaying(true);
                setFailed(false);
                onPlay();
              },
              onPause: () => {
                setPlaying(false);
                onPause();
              },
              onPlayAttempt,
              onFirstFrameProxy,
              onAutoplayBlocked,
              onBufferingStart,
              onBufferingEnd,
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
        seriesTitle={item.seriesTitle}
        hook={display.hook}
        episodeNumber={item.episodeNumber}
        progress={active ? progress : 0}
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
          onLike={onLike}
          onFollow={onFollow}
          onShare={onShare}
          onMute={onMute}
          onCaptions={onCaptions}
          onTune={onTune}
        />
      ) : null}

      <PlayGate visible={active && showPlayGate && !failed} onPlay={onPlayGate} />
    </article>
  );
}
