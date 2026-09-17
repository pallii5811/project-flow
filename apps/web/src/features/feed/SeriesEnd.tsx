"use client";

import type { ReactElement } from "react";

import styles from "./feed.module.css";

export type NextStory = {
  contentId: string;
  seriesTitle: string;
  hook: string;
  posterUrl: string;
  /** "Episode 1 / 60" */
  position: string;
};

type SeriesEndProps = {
  seriesTitle: string;
  /** series_complete: the last episode; series_unavailable_next: the next one is not out. */
  kind?: "series_complete" | "series_unavailable_next";
  /** "5 episodes" or "Episode 3 / 60", already worded. */
  position: string;
  following: boolean;
  /** Another story to start with one tap; null when the catalog has none. */
  nextStory: NextStory | null;
  onShare: () => void;
  onFollow: () => void;
  onNextStory: () => void;
  onClose: () => void;
};

/**
 * The end of a series is a handoff, not a dead end (UX-06, VIR-7): share and
 * follow while the story is fresh, and the next story one explicit tap away.
 * Nothing starts by itself: another series never autoplays (docs/decisions.md,
 * Prompt D).
 */
export function SeriesEnd({
  seriesTitle,
  kind = "series_complete",
  position,
  following,
  nextStory,
  onShare,
  onFollow,
  onNextStory,
  onClose,
}: SeriesEndProps): ReactElement {
  const complete = kind === "series_complete";

  return (
    <div
      className={styles.seriesEnd}
      role="region"
      aria-label={`End of ${seriesTitle}`}
      data-series-end={kind}
    >
      <button
        type="button"
        className={styles.seriesEndClose}
        onClick={onClose}
        aria-label="Close"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div className={styles.seriesEndBody}>
        <p className={styles.seriesEndLabel}>{complete ? "Series complete" : "More episodes soon"}</p>
        <h2 className={styles.seriesEndTitle}>{seriesTitle}</h2>
        <p className={styles.seriesEndMeta}>
          {complete
            ? `You watched the whole story · ${position}`
            : `You’re up to date · ${position}. The next episode isn’t out yet.`}
        </p>

        <div className={styles.seriesEndActions}>
          <button
            type="button"
            className={styles.seriesEndAction}
            onClick={onShare}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M12 3.5v11M7.5 8 12 3.5 16.5 8" />
              <path d="M5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6" />
            </svg>
            Share this story
          </button>
          <button
            type="button"
            className={styles.seriesEndAction}
            onClick={onFollow}
            aria-pressed={following}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              {following ? (
                <path d="M5 12.5l4.2 4.2L19 7" />
              ) : (
                <path d="M12 5v14M5 12h14" />
              )}
            </svg>
            {following ? "Following" : "Follow series"}
          </button>
        </div>
      </div>

      {nextStory ? (
        <button
          type="button"
          className={styles.nextStory}
          onClick={onNextStory}
          data-next-story={nextStory.contentId}
        >
          <img className={styles.nextStoryPoster} src={nextStory.posterUrl} alt="" draggable={false} />
          <span className={styles.nextStoryText}>
            <span className={styles.nextStoryLabel}>Next story</span>
            <span className={styles.nextStoryTitle}>{nextStory.seriesTitle}</span>
            <span className={styles.nextStoryHook}>{nextStory.hook}</span>
            <span className={styles.nextStoryMeta}>{nextStory.position}</span>
          </span>
          <span className={styles.nextStoryPlay} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" focusable="false">
              <path d="M8.5 5.8v12.4L19 12 8.5 5.8z" />
            </svg>
          </span>
        </button>
      ) : (
        <p className={styles.seriesEndCatalog}>That’s every story we have right now.</p>
      )}
    </div>
  );
}
