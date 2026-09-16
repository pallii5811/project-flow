"use client";

import type { ReactElement } from "react";

import styles from "./feed.module.css";

type ContentOverlayProps = {
  seriesTitle: string;
  hook: string;
  episodeNumber: number;
  progress: number;
  active?: boolean;
};

export function ContentOverlay({
  seriesTitle,
  hook,
  episodeNumber,
  progress,
  active = true,
}: ContentOverlayProps): ReactElement {
  const clamped = Math.min(1, Math.max(0, progress));
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
      {active ? (
        <div
          className={styles.progressEdge}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(clamped * 100)}
          aria-label="Episode progress"
        >
          <div
            className={styles.progressFill}
            style={{ transform: `scaleX(${clamped})` }}
          />
        </div>
      ) : null}
    </>
  );
}
