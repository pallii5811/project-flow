"use client";

import type { ReactElement } from "react";

import styles from "./feed.module.css";

type ContinueStripProps = {
  seriesTitle: string;
  /** "Episode 3 / 60" */
  episodeLabel: string;
  onContinue: () => void;
};

/**
 * A returning viewer landed mid-episode: Continue jumps to the saved moment
 * (the episode plays from its start behind the strip until then).
 */
export function ContinueStrip({
  seriesTitle,
  episodeLabel,
  onContinue,
}: ContinueStripProps): ReactElement {
  return (
    <div className={styles.strip} role="region" aria-label="Continue story" data-resume-offer="resume">
      <p className={styles.stripLabel}>Continue story</p>
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

/**
 * A returning viewer who finished an episode lands on the next one, already
 * playing from its start. There is nothing to press (B2-UPNEXT): a short
 * label says where they are, then fades on its own.
 */
export function UpNextLabel({
  seriesTitle,
  episodeLabel,
}: {
  seriesTitle: string;
  episodeLabel: string;
}): ReactElement {
  return (
    <div className={styles.upNext} role="status" data-resume-offer="next_episode">
      <span className={styles.upNextKicker}>Next episode</span>
      <span className={styles.upNextText}>
        {seriesTitle} · {episodeLabel}
      </span>
    </div>
  );
}
