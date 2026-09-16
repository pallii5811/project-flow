"use client";

import { useCallback, useSyncExternalStore, type ReactElement } from "react";

import type { ProgressStore } from "./progressStore";
import styles from "./feed.module.css";

type ContentOverlayProps = {
  contentId: string;
  seriesTitle: string;
  hook: string;
  episodeNumber: number;
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
  progressStore,
  active = true,
}: ContentOverlayProps): ReactElement {
  return (
    <>
      <div className={styles.scrimTop} aria-hidden="true" />
      <div className={styles.scrimBottom} aria-hidden="true" />
      <div
        className={`${styles.overlay}${active ? "" : ` ${styles.overlayInactive}`}`}
      >
        <h2 className={styles.seriesTitle}>{seriesTitle}</h2>
        <p className={styles.hook}>{hook}</p>
        <p className={styles.episodeLabel}>Episode {episodeNumber}</p>
      </div>
      {active ? <ProgressEdge contentId={contentId} progressStore={progressStore} /> : null}
    </>
  );
}
