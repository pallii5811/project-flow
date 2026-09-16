/**
 * Shape tokens. Prefer fewer visible containers — not everything is rounded.
 */
export const radii = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export type RadiusToken = keyof typeof radii;
