"use client";

import type { ReactElement } from "react";

import styles from "./feed.module.css";

type SeriesEndProps = {
  seriesTitle: string;
  onDismiss: () => void;
};

export function SeriesEnd({
  seriesTitle,
  onDismiss,
}: SeriesEndProps): ReactElement {
  return (
    <div
      className={styles.seriesEnd}
      role="region"
      aria-label={`End of ${seriesTitle}`}
    >
      <p className={styles.seriesEndLabel}>Episode complete</p>
      <p className={styles.seriesEndTitle}>{seriesTitle}</p>
      <p className={styles.seriesEndMeta}>You finished this story.</p>
      <button
        type="button"
        className={styles.seriesEndButton}
        onClick={onDismiss}
        aria-label="Keep watching feed"
      >
        Keep watching
      </button>
    </div>
  );
}
