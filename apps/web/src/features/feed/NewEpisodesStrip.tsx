"use client";

import type { ReactElement } from "react";

import styles from "./feed.module.css";

type NewEpisodesStripProps = {
  seriesId: string;
  seriesTitle: string;
  /** "2 new episodes", already counted (newEpisodesLine). */
  countLine: string;
  /** The episode the viewer has not seen, e.g. "Episode 4". */
  episodeLabel: string;
  onOpen: () => void;
  onDismiss: () => void;
};

/**
 * The promise a follow makes, kept: a viewer who followed a series is told
 * what appeared since they were last told, once, and is one tap from the
 * first episode they have not seen.
 *
 * There is no server and no notification (retentionState.ts): this is the
 * whole of "this story will find you again" until a Worker can push. It waits
 * until an episode is playing and takes the strip slot only when nothing the
 * viewer asked for is using it.
 */
export function NewEpisodesStrip({
  seriesId,
  seriesTitle,
  countLine,
  episodeLabel,
  onOpen,
  onDismiss,
}: NewEpisodesStripProps): ReactElement {
  return (
    <div
      className={styles.strip}
      role="region"
      aria-label="New episodes"
      data-new-episodes={seriesId}
    >
      <div className={styles.stripHead}>
        <p className={styles.stripLabel}>New since you were here</p>
        <button
          type="button"
          className={styles.stripDismiss}
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <p className={styles.stripTitle}>{seriesTitle}</p>
      <p className={styles.stripMeta} data-new-episodes-count="true">
        {countLine}
      </p>
      <button
        type="button"
        className={styles.stripButton}
        onClick={onOpen}
        data-new-episodes-open="true"
      >
        Watch {episodeLabel.toLowerCase()}
      </button>
    </div>
  );
}
