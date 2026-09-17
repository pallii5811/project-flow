"use client";

import { shouldRenderSlide, type ContentItem } from "@project-flow/feed-domain";
import {
  useCallback,
  useEffect,
  useRef,
  type ReactElement,
  type RefObject,
} from "react";

import { FeedItemView, FeedSlidePlaceholder, type FeedItemHandlers } from "./FeedItemView";
import { isAtSlide, settledIndex } from "./feedLogic";
import type { ProgressStore } from "./progressStore";
import styles from "./feed.module.css";

/** Without a `scrollend` event, scrolling counts as settled after this quiet time. */
const SCROLL_SETTLE_FALLBACK_MS = 150;

type FeedScrollerProps = {
  items: ContentItem[];
  index: number;
  onIndexChange: (next: number) => void;
  muted: boolean;
  captionsOn: boolean;
  likedIds: Set<string>;
  followingIds: Set<string>;
  seekToMs: number | null;
  showPlayGate: boolean;
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
  likedIds,
  followingIds,
  seekToMs,
  showPlayGate,
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
      if (scrollingFromProp.current) return;
      const next = settledIndex(root.scrollTop, root.clientHeight, items.length);
      if (next !== null && next !== index) onIndexChange(next);
    };

    const onScroll = () => {
      if (supportsScrollEnd || scrollingFromProp.current) return;
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
        handlers.onToggleMute();
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
            seekToMs={active ? seekToMs : null}
            showPlayGate={showPlayGate}
            locale={locale}
            progressStore={progressStore}
            handlers={handlers}
          />
        );
      })}
    </div>
  );
}
