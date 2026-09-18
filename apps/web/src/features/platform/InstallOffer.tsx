"use client";

import type { ReactElement } from "react";

import { BRAND_NAME } from "@/lib/brand";

import type { InstallPlatform } from "./installRules";
import styles from "./platform.module.css";

/** Safari's share glyph, drawn so the hint points at the real button. */
function ShareGlyph(): ReactElement {
  return (
    <svg
      className={styles.installShare}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Share"
      role="img"
    >
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H17" />
    </svg>
  );
}

/**
 * The one-time invitation to keep the app on the home screen (A11Y-04).
 * A card in the notices' slot: it never takes focus, never covers the rail,
 * and one tap on "Not now" ends it for good. See installRules.ts for when.
 */
export function InstallOffer({
  platform,
  onAccept,
  onDismiss,
}: {
  platform: InstallPlatform;
  onAccept: () => void;
  onDismiss: () => void;
}): ReactElement {
  const ios = platform === "ios";
  return (
    <section
      className={styles.install}
      aria-label={`Install ${BRAND_NAME}`}
      data-install-offer={platform}
    >
      <img className={styles.installIcon} src="/icons/icon-192.png" alt="" width={40} height={40} />
      <p className={styles.installTitle}>{`Keep ${BRAND_NAME} one tap away`}</p>
      <p className={styles.installBody}>
        {ios ? (
          <>
            Tap <ShareGlyph />, then “Add to Home Screen”.
          </>
        ) : (
          "Full screen, straight back into your story."
        )}
      </p>
      <div className={styles.installActions}>
        {ios ? (
          <button type="button" className={styles.installQuiet} onClick={onAccept}>
            Got it
          </button>
        ) : (
          <>
            <button type="button" className={styles.installQuiet} onClick={onDismiss}>
              Not now
            </button>
            <button type="button" className={styles.installButton} onClick={onAccept}>
              Install
            </button>
          </>
        )}
      </div>
    </section>
  );
}
