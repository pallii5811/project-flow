"use client";

import { shouldRenderSlide, type ContentItem } from "@project-flow/feed-domain";
import { useCallback, useEffect, useRef, type ReactElement, type RefObject } from "react";

import {
  FeedItemView,
  FeedSlidePlaceholder,
  type FeedItemHandlers,
} from "./FeedItemView";
import { isAtSlide, settledIndex, type FailureHold } from "./feedLogic";
import type { ProgressStore } from "./progressStore";
import styles from "./feed.module.css";

/** Without a `scrollend` event, scrolling counts as settled after this quiet time. */
const SCROLL_SETTLE_FALLBACK_MS = 150;

type FeedScrollerProps = {
  items: ContentItem[];
  index: number;
  /**
   * The slide on screen changed. `gestureStartedAt` (performance.now()) is the
   * first scroll event of the gesture that got there, so swipe latency counts
   * the snap and the settle wait the viewer sees; absent for keys.
   */
  onIndexChange: (next: number, gestureStartedAt?: number) => void;
  muted: boolean;
  captionsOn: boolean;
  /** Episodes per series, from the catalog the feed knows. */
  episodeCounts: ReadonlyMap<string, number>;
  /** The Continue strip lies over this episode's title block. */
  coveredContentId?: string | null;
  likedIds: Set<string>;
  followingIds: Set<string>;
  seekToMs: number | null;
  showPlayGate: boolean;
  /** Why the failed active episode waits instead of skipping, if it does. */
  failureHold: FailureHold | null;
  prefetchIds: Set<string>;
  locale?: string | null;
  progressStore: ProgressStore;
  /** Stable identity (createStableHandlers): memoized slides depend on it. */
  handlers: FeedItemHandlers;
  scrollerRef?: RefObject<HTMLDivElement | null>;
};

export function FeedScroller({
  items,
  index,
  onIndexChange,
  muted,
  captionsOn,
  episodeCounts,
  coveredContentId = null,
  likedIds,
  followingIds,
  seekToMs,
  showPlayGate,
  failureHold,
  prefetchIds,
  locale,
  progressStore,
  handlers,
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
  /** performance.now() of the first scroll event since the scroller last rested. */
  const gestureStartedAt = useRef<number | null>(null);

  useEffect(() => {
    const root = localRef.current;
    if (!root) return;
    const target = root.children.item(index) as HTMLElement | null;
    if (!target) return;
    // Already there (the viewer's own swipe got here): a forced jump would
    // fight momentum and scroll-snap (PB-6).
    if (isAtSlide(root.scrollTop, target.offsetTop)) return;
    scrollingFromProp.current = true;
    target.scrollIntoView({ behavior: "auto", block: "start" });
    requestAnimationFrame(() => {
      scrollingFromProp.current = false;
    });
  }, [index, items.length]);

  // The active slide changes once the gesture is over (scrollend), never at
  // the halfway mark while the finger is still down (PB-6).
  useEffect(() => {
    const root = localRef.current;
    if (!root) return;
    const supportsScrollEnd = "onscrollend" in window;
    let settleTimer: number | null = null;

    const commit = () => {
      settleTimer = null;
      const startedAt = gestureStartedAt.current;
      gestureStartedAt.current = null;
      if (scrollingFromProp.current) return;
      const next = settledIndex(root.scrollTop, root.clientHeight, items.length);
      if (next !== null && next !== index) onIndexChange(next, startedAt ?? undefined);
    };

    const onScroll = () => {
      if (scrollingFromProp.current) return;
      gestureStartedAt.current ??= performance.now();
      if (supportsScrollEnd) return;
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(commit, SCROLL_SETTLE_FALLBACK_MS);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    if (supportsScrollEnd) root.addEventListener("scrollend", commit);
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (supportsScrollEnd) root.removeEventListener("scrollend", commit);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
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
        handlers.onTogglePlayPause();
      } else if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        handlers.onToggleMute("key");
      } else if (event.key === "c" || event.key === "C") {
        handlers.onToggleCaptions();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers, index, items.length, onIndexChange]);

  return (
    <div className={styles.scroller} ref={setRef} tabIndex={0} role="feed">
      {items.map((item, itemIndex) => {
        // Far slides are empty boxes: the list can hold a whole page while
        // only the slides around the playing one download anything.
        if (!shouldRenderSlide(itemIndex, index)) {
          return <FeedSlidePlaceholder key={item.id} contentId={item.id} />;
        }
        const active = itemIndex === index;
        const inWindow = prefetchIds.has(item.id);
        // Next episode: full preload for zero-gap swipe; neighbors: metadata only.
        const isNext = itemIndex === index + 1;
        const preload: "none" | "metadata" | "auto" =
          active || isNext ? "auto" : inWindow ? "metadata" : "none";
        return (
          <FeedItemView
            key={item.id}
            item={item}
            active={active}
            preload={preload}
            muted={muted}
            captionsOn={captionsOn && item.captionsAvailable}
            episodeCount={episodeCounts.get(item.seriesId) ?? null}
            overlayCovered={active && coveredContentId === item.id}
            liked={likedIds.has(item.id)}
            following={followingIds.has(item.seriesId)}
            seekToMs={active ? seekToMs : null}
            showPlayGate={showPlayGate}
            failureHold={active ? failureHold : null}
            locale={locale}
            progressStore={progressStore}
            handlers={handlers}
          />
        );
      })}
    </div>
  );
}
