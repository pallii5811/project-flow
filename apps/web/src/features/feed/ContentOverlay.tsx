"use client";

import { useCallback, useSyncExternalStore, type ReactElement } from "react";

import type { ProgressStore } from "./progressStore";
import { episodePosition } from "./storyThread";
import styles from "./feed.module.css";

type ContentOverlayProps = {
  contentId: string;
  seriesTitle: string;
  hook: string;
  episodeNumber: number;
  episodeCount: number | null;
  /** Dialogue to show now (captions on and a cue active), else null. */
  caption: string | null;
  /** The Continue strip lies over the title block. */
  covered?: boolean;
  progressStore: ProgressStore;
  active?: boolean;
};

/**
 * The only component that re-renders while an episode plays: it subscribes to
 * the progress of its own episode, so the rest of the feed stays still.
 */
function ProgressEdge({
  contentId,
  progressStore,
}: {
  contentId: string;
  progressStore: ProgressStore;
}): ReactElement {
  const subscribe = useCallback(
    (listener: () => void) => progressStore.subscribe(contentId, listener),
    [contentId, progressStore],
  );
  const progress = useSyncExternalStore(
    subscribe,
    () => progressStore.get(contentId),
    () => 0,
  );
  return (
    <div
      className={styles.progressEdge}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-label="Episode progress"
    >
      <div className={styles.progressFill} style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}

export function ContentOverlay({
  contentId,
  seriesTitle,
  hook,
  episodeNumber,
  episodeCount,
  caption,
  covered = false,
  progressStore,
  active = true,
}: ContentOverlayProps): ReactElement {
  const position = episodePosition(episodeNumber, episodeCount);
  return (
    <>
      <div className={styles.scrimTop} aria-hidden="true" />
      <div className={styles.scrimBottom} aria-hidden="true" />
      <div
        // Neighbours keep full contrast: they are read mid-swipe, and a dimmed
        // overlay replayed its entrance when it became active (A11Y-06).
        className={`${styles.overlay}${covered ? ` ${styles.overlayCovered}` : ""}`}
      >
        {/*
          Captions sit in the same column, right above the title block: over
          the scrim, never under the text, whatever the title's length (A11Y-01).
          The slot keeps no height when empty, so nothing jumps between cues
          except the dialogue itself.
        */}
        {caption ? (
          <p className={styles.caption} data-caption="true">
            {caption.split("\n").map((line, lineIndex) => (
              <span key={lineIndex} className={styles.captionRow}>
                <span className={styles.captionLine}>{line}</span>
              </span>
            ))}
          </p>
        ) : null}
        <p className={styles.episodeKicker} data-episode-position="true">
          <span aria-hidden="true">{position.text}</span>
          <span className={styles.visuallyHidden}>{position.label}</span>
        </p>
        <h2 className={styles.seriesTitle}>{seriesTitle}</h2>
        <p className={styles.hook}>{hook}</p>
      </div>
      {active ? (
        <ProgressEdge contentId={contentId} progressStore={progressStore} />
      ) : null}
    </>
  );
}
