"use client";

import { shouldRenderSlide, type ContentItem } from "@project-flow/feed-domain";
import { useCallback, useEffect, useRef, type ReactElement, type RefObject } from "react";

import {
  FeedItemView,
  FeedSlidePlaceholder,
  type FeedItemHandlers,
} from "./FeedItemView";
import { feedKeyAction, shouldMoveFocusToSlide } from "./a11y";
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
  /**
   * A modal sheet is open: the feed takes no keys and is inert behind it, so
   * Tab and screen readers stay in the sheet.
   */
  modalOpen?: boolean;
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
  modalOpen = false,
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
      const target = event.target instanceof Element ? event.target : null;
      const action = feedKeyAction({
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        defaultPrevented: event.defaultPrevented,
        dialogOpen: modalOpen,
        inDialog: target?.closest('[role="dialog"]') != null,
        inTextField:
          target?.closest('input, textarea, select, [contenteditable="true"]') != null,
        onControl: target?.closest('button, a[href], [role="button"], summary') != null,
      });
      if (action === null) return;
      switch (action) {
        case "next":
          event.preventDefault();
          if (index < items.length - 1) onIndexChange(index + 1);
          break;
        case "previous":
          event.preventDefault();
          if (index > 0) onIndexChange(index - 1);
          break;
        case "toggle_play":
          event.preventDefault();
          handlers.onTogglePlayPause();
          break;
        case "toggle_mute":
          event.preventDefault();
          handlers.onToggleMute("key");
          break;
        case "toggle_captions":
          handlers.onToggleCaptions();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers, index, items.length, modalOpen, onIndexChange]);

  // Where focus last was: in the feed, or somewhere else on the page. A
  // focused rail button unmounts with its slide and fires no event, so this
  // is the only way to know it was there (A11Y-07).
  const lastFocusInFeed = useRef(false);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const root = localRef.current;
      lastFocusInFeed.current =
        root !== null && event.target instanceof Node && root.contains(event.target);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  // The episode changed while focus was in the feed: it moves to the new
  // slide instead of falling back to the page with the old rail.
  const focusedIndex = useRef(index);
  useEffect(() => {
    if (focusedIndex.current === index) return;
    focusedIndex.current = index;
    const root = localRef.current;
    if (!root) return;
    const active = document.activeElement;
    const now =
      active === null || active === document.body
        ? "page"
        : root.contains(active)
          ? "feed"
          : "elsewhere";
    if (!shouldMoveFocusToSlide(lastFocusInFeed.current, now)) return;
    const slide = root.children.item(index);
    if (slide instanceof HTMLElement && !slide.contains(active)) {
      slide.focus({ preventScroll: true });
    }
  }, [index]);

  return (
    <div
      className={styles.scroller}
      ref={setRef}
      tabIndex={0}
      role="feed"
      aria-label="Episodes"
      inert={modalOpen}
    >
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
            position={itemIndex + 1}
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
