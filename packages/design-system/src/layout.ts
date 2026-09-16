import { spacing } from "./spacing";

/**
 * Layout constants for touch-first, video-ready surfaces.
 */
export const layout = {
  /** Horizontal inset for non-edge-to-edge content */
  screenMargin: spacing.md,
  /** Minimum comfortable hit area (pt) — visual control may be smaller */
  minTouchTarget: 44,
  hairline: 1,
  maxContentWidth: 480,
  /** Suggested scrim band heights for future video overlays */
  scrimTop: 96,
  scrimBottom: 160,
  /** Icon optical sizes */
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
} as const;

export type LayoutTokens = typeof layout;
