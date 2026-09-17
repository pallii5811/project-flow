"use client";

import type { ReactElement } from "react";

import styles from "./feed.module.css";

type ContinueStripProps = {
  seriesTitle: string;
  episodeLabel: string;
  /** "Continue story", or "Up next" when the saved episode was finished. */
  label?: string;
  onContinue: () => void;
};

export function ContinueStrip({
  seriesTitle,
  episodeLabel,
  label = "Continue story",
  onContinue,
}: ContinueStripProps): ReactElement {
  return (
    <div className={styles.strip} role="region" aria-label="Continue story">
      <p className={styles.stripLabel}>{label}</p>
      <p className={styles.stripTitle}>{seriesTitle}</p>
      <p className={styles.stripMeta}>{episodeLabel}</p>
      <button
        type="button"
        className={styles.stripButton}
        onClick={onContinue}
        aria-label="Continue episode"
      >
        Continue
      </button>
    </div>
  );
}
