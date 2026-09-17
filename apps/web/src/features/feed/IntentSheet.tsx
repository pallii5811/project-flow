"use client";

import {
  INTENT_CHIP_IDS,
  INTENT_CHIP_LABELS,
  type IntentChipId,
} from "@project-flow/feed-domain";
import { useEffect, useRef, type ReactElement } from "react";

import { trappedFocusIndex } from "./a11y";
import styles from "./feed.module.css";

type IntentSheetProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (chipId: IntentChipId) => void;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A real modal dialog (A11Y-02, UX-09): focus moves to the first chip, Tab
 * stays inside, Escape closes it wherever focus is, and focus goes back to
 * the control that opened it. The feed behind is inert while it is open.
 */
export function IntentSheet({
  open,
  onClose,
  onSelect,
}: IntentSheetProps): ReactElement | null {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sheet = sheetRef.current;
    sheet
      ?.querySelector<HTMLElement>("[data-intent-chip]")
      ?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !sheet) return;
      const focusable = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = trappedFocusIndex(focusable.length, current, event.shiftKey);
      event.preventDefault();
      focusable[next]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Back where the viewer was; if that control is gone, to the feed.
      const target =
        opener?.isConnected === true
          ? opener
          : document.querySelector<HTMLElement>('[role="feed"] [data-active="true"]');
      target?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className={styles.sheetBackdrop} role="presentation" onClick={onClose}>
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="intent-sheet-title"
        data-intent-sheet="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.sheetHeader}>
          <h2 id="intent-sheet-title" className={styles.sheetTitle}>
            Tune what plays next
          </h2>
          <button
            type="button"
            className={styles.sheetClose}
            aria-label="Close"
            onClick={onClose}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
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
        <div className={styles.chipRow}>
          {INTENT_CHIP_IDS.map((chipId) => (
            <button
              key={chipId}
              type="button"
              className={styles.chip}
              data-intent-chip={chipId}
              onClick={() => onSelect(chipId)}
            >
              {INTENT_CHIP_LABELS[chipId]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
