"use client";

import type { ReactElement } from "react";

import styles from "./feed.module.css";

type PlayGateProps = {
  visible: boolean;
  onPlay: () => void;
};

/** Minimal tap-to-play — product state, never an error screen. */
export function PlayGate({ visible, onPlay }: PlayGateProps): ReactElement | null {
  if (!visible) return null;

  return (
    <div className={styles.playGate}>
      <button
        type="button"
        className={styles.playGateButton}
        aria-label="Play"
        onClick={onPlay}
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8.5 5.8v12.4L19 12 8.5 5.8z" />
        </svg>
      </button>
    </div>
  );
}
