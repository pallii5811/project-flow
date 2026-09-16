export type TypographyStyle = {
  fontSize: number;
  lineHeight: number;
  fontWeight: "400" | "500" | "600" | "700";
  letterSpacing: number;
};

/**
 * Type scale — sizes/weights for product UI.
 * Web consumer pairs CSS vars `--font-display` (Syne) + `--font-body` (Manrope).
 * Mobile RN remains system fonts until native typefaces ship.
 * Line heights stay localization-safe (≥ 1.25× size for body).
 */
export const typography = {
  display: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: "600",
    letterSpacing: -0.6,
  },
  headlineLarge: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "600",
    letterSpacing: -0.4,
  },
  headlineMedium: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  headlineSmall: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  titleLarge: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  titleMedium: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600",
    letterSpacing: 0,
  },
  titleSmall: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    letterSpacing: 0,
  },
  bodyLarge: {
    fontSize: 17,
    lineHeight: 26,
    fontWeight: "400",
    letterSpacing: 0,
  },
  bodyMedium: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "400",
    letterSpacing: 0,
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "400",
    letterSpacing: 0,
  },
  labelLarge: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "500",
    letterSpacing: 0.1,
  },
  labelMedium: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    letterSpacing: 0.1,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "400",
    letterSpacing: 0.2,
  },
} as const satisfies Record<string, TypographyStyle>;

export type TypographyToken = keyof typeof typography;
