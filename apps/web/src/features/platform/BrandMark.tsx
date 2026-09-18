import type { ReactElement } from "react";

import { BRAND_NAME } from "@/lib/brand";

import styles from "./platform.module.css";

/**
 * The mark and the name, as the pages outside the feed show them (404,
 * offline). The glyph is the app icon's mark (apps/web/brand/mark.svg), drawn
 * inline so it needs no request.
 */
export function BrandMark({ className }: { className?: string }): ReactElement {
  return (
    <p className={`${styles.brand}${className ? ` ${className}` : ""}`}>
      <svg
        className={styles.brandGlyph}
        viewBox="164 96 184 320"
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M208 96h96a44 44 0 0 1 44 44v232a44 44 0 0 1-44 44h-96a44 44 0 0 1-44-44V140a44 44 0 0 1 44-44zm31 104v80l56-35z"
        />
      </svg>
      <span>{BRAND_NAME}</span>
    </p>
  );
}
