import Link from "next/link";
import type { ReactElement } from "react";

import styles from "./platform.module.css";

/**
 * Try again. The service worker answers an unreachable page with a copy of
 * this page stripped of the app's scripts (offline-shell.html, written by
 * scripts/finish-export.mjs), so the address bar still holds what the viewer
 * asked for; public/offline.js makes this link reload that address and
 * reloads by itself when the network is back. Without it the link opens the
 * feed.
 */
export function OfflineRetry(): ReactElement {
  return (
    <Link href="/" prefetch={false} className={styles.offlineButton} data-offline-retry="true">
      <svg
        className={styles.offlineButtonGlyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M20 11a8 8 0 1 0-2.3 5.7" />
        <path d="M20 4v7h-7" />
      </svg>
      Try again
    </Link>
  );
}
