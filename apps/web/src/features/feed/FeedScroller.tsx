"use client";

import type { ContentItem } from "@project-flow/feed-domain";
import {
  useCallback,
  useEffect,
  useRef,
  type ReactElement,
  type RefObject,
} from "react";

import { FeedItemView } from "./FeedItemView";
import styles from "./feed.module.css";

type FeedScrollerProps = {
  items: ContentItem[];
  index: number;
  onIndexChange: (next: number) => void;
  muted: boolean;
  captionsOn: boolean;
  likedIds: Set<string>;
  followingIds: Set<string>;
  progressById: Record<string, number>;
  seekToMs: number | null;
  showPlayGate: boolean;
  prefetchIds: Set<string>;
  locale?: string | null;
  onToggleMute: () => void;
  onUnmute: () => void;
  onToggleCaptions: () => void;
  onTogglePlayPause: () => void;
  onPlayGate: () => void;
  onLike: (item: ContentItem) => void;
  onFollow: (item: ContentItem) => void;
  onShare: (item: ContentItem) => void;
  onTune: () => void;
  onCanPlay: (item: ContentItem) => void;
  onLoadStart: (item: ContentItem) => void;
  onPosterVisible: (item: ContentItem) => void;
  onMetadataReady: (item: ContentItem) => void;
  onTimeUpdate: (
    item: ContentItem,
    positionMs: number,
    durationMs: number,
  ) => void;
  onEnded: (item: ContentItem) => void;
  onError: (item: ContentItem, code: string, reason: string) => void;
  onPlay: (item: ContentItem) => void;
  onPause: (item: ContentItem) => void;
  onPlayAttempt: (item: ContentItem) => void;
  onFirstFrameProxy: (item: ContentItem) => void;
  onAutoplayBlocked: () => void;
  onBufferingStart: (item: ContentItem) => void;
  onBufferingEnd: (item: ContentItem) => void;
  scrollerRef?: RefObject<HTMLDivElement | null>;
};

export function FeedScroller({
  items,
  index,
  onIndexChange,
  muted,
  captionsOn,
  likedIds,
  followingIds,
  progressById,
  seekToMs,
  showPlayGate,
  prefetchIds,
  locale,
  onToggleMute,
  onUnmute,
  onToggleCaptions,
  onTogglePlayPause,
  onPlayGate,
  onLike,
  onFollow,
  onShare,
  onTune,
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
  scrollerRef,
}: FeedScrollerProps): ReactElement {
  const localRef = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      localRef.current = node;
      if (scrollerRef) {
        (scrollerRef as { current: HTMLDivElement | null }).current = node;
      }
    },
    [scrollerRef],
  );

  const scrollingFromProp = useRef(false);

  useEffect(() => {
    const root = localRef.current;
    if (!root) return;
    const target = root.children.item(index) as HTMLElement | null;
    if (!target) return;
    scrollingFromProp.current = true;
    target.scrollIntoView({ behavior: "auto", block: "start" });
    requestAnimationFrame(() => {
      scrollingFromProp.current = false;
    });
  }, [index, items.length]);

  useEffect(() => {
    const root = localRef.current;
    if (!root) return;

    const onScroll = () => {
      if (scrollingFromProp.current) return;
      const height = root.clientHeight || 1;
      const next = Math.round(root.scrollTop / height);
      if (next !== index && next >= 0 && next < items.length) {
        onIndexChange(next);
      }
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [index, items.length, onIndexChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (index < items.length - 1) onIndexChange(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (index > 0) onIndexChange(index - 1);
      } else if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        onTogglePlayPause();
      } else if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        onToggleMute();
      } else if (event.key === "c" || event.key === "C") {
        onToggleCaptions();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    index,
    items.length,
    onIndexChange,
    onToggleCaptions,
    onToggleMute,
    onTogglePlayPause,
  ]);

  return (
    <div className={styles.scroller} ref={setRef} tabIndex={0} role="feed">
      {items.map((item, itemIndex) => {
        const active = itemIndex === index;
        const inWindow = prefetchIds.has(item.id);
        // Next episode: full preload for zero-gap swipe; neighbors: metadata only.
        const isNext = itemIndex === index + 1;
        const preload: "none" | "metadata" | "auto" = active || isNext
          ? "auto"
          : inWindow
            ? "metadata"
            : "none";
        return (
          <FeedItemView
            key={item.id}
            item={item}
            active={active}
            preload={preload}
            muted={muted}
            captionsOn={captionsOn}
            liked={likedIds.has(item.id)}
            following={followingIds.has(item.seriesId)}
            progress={progressById[item.id] ?? 0}
            seekToMs={active ? seekToMs : null}
            showPlayGate={showPlayGate}
            locale={locale}
            onPlayGate={onPlayGate}
            onLike={() => onLike(item)}
            onFollow={() => onFollow(item)}
            onShare={() => onShare(item)}
            onMute={onToggleMute}
            onUnmute={onUnmute}
            onCaptions={onToggleCaptions}
            onTune={onTune}
            onTogglePlayPause={onTogglePlayPause}
            onCanPlay={() => onCanPlay(item)}
            onLoadStart={() => onLoadStart(item)}
            onPosterVisible={() => onPosterVisible(item)}
            onMetadataReady={() => onMetadataReady(item)}
            onTimeUpdate={(positionMs, durationMs) =>
              onTimeUpdate(item, positionMs, durationMs)
            }
            onEnded={() => onEnded(item)}
            onError={(code, reason) => onError(item, code, reason)}
            onPlay={() => onPlay(item)}
            onPause={() => onPause(item)}
            onPlayAttempt={() => onPlayAttempt(item)}
            onFirstFrameProxy={() => onFirstFrameProxy(item)}
            onAutoplayBlocked={onAutoplayBlocked}
            onBufferingStart={() => onBufferingStart(item)}
            onBufferingEnd={() => onBufferingEnd(item)}
          />
        );
      })}
    </div>
  );
}
