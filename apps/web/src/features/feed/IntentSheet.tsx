"use client";

import {
  INTENT_CHIP_IDS,
  INTENT_CHIP_LABELS,
  type IntentChipId,
} from "@project-flow/feed-domain";
import type { ReactElement } from "react";

import styles from "./feed.module.css";

type IntentSheetProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (chipId: IntentChipId) => void;
};

export function IntentSheet({
  open,
  onClose,
  onSelect,
}: IntentSheetProps): ReactElement | null {
  if (!open) return null;

  return (
    <div
      className={styles.sheetBackdrop}
      role="presentation"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="Tune what plays next"
        onClick={(event) => event.stopPropagation()}
      >
        <p className={styles.sheetTitle}>Tune what plays next</p>
        <div className={styles.chipRow}>
          {INTENT_CHIP_IDS.map((chipId) => (
            <button
              key={chipId}
              type="button"
              className={styles.chip}
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
