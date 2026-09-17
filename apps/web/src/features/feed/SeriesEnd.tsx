"use client";

import type { ReactElement } from "react";

import styles from "./feed.module.css";

type SeriesEndProps = {
  seriesTitle: string;
  /** series_complete: the last episode; series_unavailable_next: the next one is not out. */
  kind?: "series_complete" | "series_unavailable_next";
  onDismiss: () => void;
};

export function SeriesEnd({
  seriesTitle,
  kind = "series_complete",
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
      <p className={styles.seriesEndMeta}>
        {kind === "series_complete"
          ? "You finished this story."
          : "The next episode isn’t available yet."}
      </p>
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
