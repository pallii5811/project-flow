"use client";

import { useState, type CSSProperties, type ReactElement } from "react";

import styles from "./feed.module.css";

export type Notice = {
  /** Changes with each notice, so the same message twice still re-announces. */
  id: number;
  kind: "sound" | "share_copied" | "share_failed";
  text: string;
  /** A link the viewer can copy by hand when the clipboard refused. */
  detail?: string;
};

function SpeakerGlyph(): ReactElement {
  return (
    <svg
      className={styles.noticeGlyph}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.4 6.6a8 8 0 0 1 0 10.8" />
    </svg>
  );
}

function CheckGlyph(): ReactElement {
  return (
    <svg
      className={styles.noticeGlyph}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  );
}

/**
 * The one place short notices appear, at the top of the frame, away from the
 * story and the thumb. The sound cue is visual only (the Unmute buttons carry
 * it for screen readers); share results are announced through role=status,
 * which stays mounted so the announcement is never lost.
 */
export function NoticePill({
  notice,
  durationMs,
}: {
  notice: Notice | null;
  /** How long the notice stays: its fade-out ends then. */
  durationMs: number;
}): ReactElement {
  const announced = notice && notice.kind !== "sound" ? notice : null;
  return (
    <>
      <div
        className={styles.noticeLive}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announced ? (
          <span key={announced.id} className={styles.visuallyHidden}>
            {announced.text}
          </span>
        ) : null}
      </div>
      {notice ? (
        <NoticeBody key={notice.id} notice={notice} durationMs={durationMs} />
      ) : null}
    </>
  );
}

function NoticeBody({
  notice,
  durationMs,
}: {
  notice: Notice;
  durationMs: number;
}): ReactElement {
  // Touched once, the pill stops fading: FeedApp keeps it while the link has
  // focus or a selection, then removes it (R3A-04).
  const [held, setHeld] = useState(false);
  const hold = () => setHeld(true);
  return (
    <div
      className={`${styles.notice}${notice.detail ? ` ${styles.noticeWithDetail}` : ""}`}
      data-notice={notice.kind}
      data-held={held ? "true" : undefined}
      style={{ "--notice-ms": `${durationMs}ms` } as CSSProperties}
      onPointerDown={notice.detail ? hold : undefined}
      onFocus={notice.detail ? hold : undefined}
    >
      {/* The text is already announced by the status region above. */}
      <span className={styles.noticeRow} aria-hidden="true">
        {notice.kind === "sound" ? <SpeakerGlyph /> : null}
        {notice.kind === "share_copied" ? <CheckGlyph /> : null}
        <span>{notice.text}</span>
      </span>
      {notice.detail ? (
        // A read-only field: reachable with Tab and by screen readers, and
        // selected whole on focus, so the link can be copied by hand.
        <input
          className={styles.noticeDetail}
          type="text"
          readOnly
          value={notice.detail}
          aria-label="Link to copy"
          data-notice-detail="true"
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}
    </div>
  );
}
