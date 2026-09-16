"use client";

import type { ReactElement, ReactNode } from "react";

import styles from "./feed.module.css";

type ActionRailProps = {
  liked: boolean;
  following: boolean;
  muted: boolean;
  captionsOn: boolean;
  captionsAvailable: boolean;
  onLike: () => void;
  onFollow: () => void;
  onShare: () => void;
  onMute: () => void;
  onCaptions: () => void;
  onTune: () => void;
};

function Icon({
  children,
  filled = false,
}: {
  children: ReactNode;
  filled?: boolean;
}): ReactElement {
  return (
    <svg
      className={`${styles.railIcon}${filled ? ` ${styles.railIconFilled}` : ""}`}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function ActionRail({
  liked,
  following,
  muted,
  captionsOn,
  captionsAvailable,
  onLike,
  onFollow,
  onShare,
  onMute,
  onCaptions,
  onTune,
}: ActionRailProps): ReactElement {
  return (
    <div className={styles.rail} role="toolbar" aria-label="Clip actions">
      <button
        type="button"
        className={styles.railButton}
        aria-label={liked ? "Unlike" : "Like"}
        aria-pressed={liked}
        onClick={onLike}
      >
        <Icon filled={liked}>
          <path d="M12 20s-7-4.35-7-9.75A4.25 4.25 0 0 1 12 7.4a4.25 4.25 0 0 1 7 2.85C19 15.65 12 20 12 20z" />
        </Icon>
      </button>
      <button
        type="button"
        className={styles.railButton}
        aria-label={following ? "Unfollow series" : "Follow series"}
        aria-pressed={following}
        onClick={onFollow}
      >
        <Icon>
          <path d="M15.5 21v-1.75a3.5 3.5 0 0 0-3.5-3.5H6.5a3.5 3.5 0 0 0-3.5 3.5V21" />
          <circle cx="9.25" cy="7.25" r="3.25" />
          <path d="M18.5 8.5v5M21 11h-5" />
        </Icon>
      </button>
      <button
        type="button"
        className={styles.railButton}
        aria-label="Share"
        onClick={onShare}
      >
        <Icon>
          <circle cx="18" cy="5" r="2.5" />
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="19" r="2.5" />
          <path d="M8.4 13.2l6.7 3.9M15.1 6.9l-6.7 3.9" />
        </Icon>
      </button>
      <button
        type="button"
        className={`${styles.railButton} ${styles.railButtonMute}`}
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        onClick={onMute}
      >
        <Icon>
          {muted ? (
            <>
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <path d="M22 9l-6 6M16 9l6 6" />
            </>
          ) : (
            <>
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <path d="M18.8 8.2a5 5 0 0 1 0 7.6" />
            </>
          )}
        </Icon>
      </button>
      {captionsAvailable ? (
        <button
          type="button"
          className={styles.railButton}
          aria-label={captionsOn ? "Hide captions" : "Show captions"}
          aria-pressed={captionsOn}
          onClick={onCaptions}
        >
          <Icon>
            <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
            <path d="M7 12h3.2M13.8 12H17" />
          </Icon>
        </button>
      ) : null}
      <button
        type="button"
        className={styles.railButton}
        aria-label="Tune what comes next"
        onClick={onTune}
      >
        <Icon>
          <circle cx="12" cy="12" r="2.25" />
          <path d="M12 3.5v2.2M12 18.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6" />
        </Icon>
      </button>
    </div>
  );
}
