"use client";

import type { ReactElement, ReactNode } from "react";

import styles from "./feed.module.css";

type FeedStageProps = {
  children: ReactNode;
};

/** Full-bleed on mobile; centered 9:16 phone frame on tablet/desktop. */
export function FeedStage({ children }: FeedStageProps): ReactElement {
  return (
    <div className={styles.stageShell}>
      <div className={styles.stage}>{children}</div>
    </div>
  );
}
