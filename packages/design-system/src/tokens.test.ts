import { describe, expect, it } from "vitest";

import {
  darkColors,
  darkTheme,
  getTheme,
  lightColors,
  lightTheme,
  motion,
  radii,
  spacing,
  themes,
  tokens,
  typography,
} from "../src/index";

describe("design tokens", () => {
  it("exports a complete spacing scale on a 4pt grid", () => {
    expect(spacing.xs).toBe(4);
    expect(spacing.md).toBe(16);
    expect(spacing["4xl"]).toBe(64);
    for (const value of Object.values(spacing)) {
      expect(value % 4).toBe(0);
    }
  });

  it("exports semantic radii including none and full", () => {
    expect(radii.none).toBe(0);
    expect(radii.full).toBe(9999);
  });

  it("exports the full typography scale", () => {
    expect(typography.display.fontSize).toBeGreaterThan(typography.caption.fontSize);
    expect(typography.bodyMedium.lineHeight).toBeGreaterThanOrEqual(
      Math.ceil(typography.bodyMedium.fontSize * 1.25),
    );
  });

  it("exports motion durations that never invent bounce defaults", () => {
    expect(motion.duration.instant).toBe(0);
    expect(motion.duration.fast).toBeLessThan(motion.duration.deliberate);
    expect(motion.patterns.press.duration).toBe("instant");
  });

  it("provides dark and light themes with semantic colors", () => {
    expect(darkTheme.colors.background).toBe(darkColors.background);
    expect(lightTheme.colors.background).toBe(lightColors.background);
    expect(getTheme("dark")).toBe(themes.dark);
    expect(getTheme("light")).toBe(themes.light);
    expect(tokens.colors.background).toBe(darkColors.background);
  });

  it("uses a warm cinematic accent instead of purple-gradient defaults", () => {
    expect(darkColors.accent).toBe("#E8DCC8");
    expect(lightColors.accent).toBe("#1A1917");
  });
});
