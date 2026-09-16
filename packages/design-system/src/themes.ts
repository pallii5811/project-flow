import { darkColors, lightColors, type ColorTokens } from "./colors";
import { elevation } from "./elevation";
import { layout } from "./layout";
import { motion } from "./motion";
import { radii } from "./radii";
import { spacing } from "./spacing";
import { typography } from "./typography";

export type ThemeName = "dark" | "light";

export type Theme = {
  name: ThemeName;
  colors: ColorTokens;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  motion: typeof motion;
  elevation: typeof elevation;
  layout: typeof layout;
};

function createTheme(name: ThemeName, colors: ColorTokens): Theme {
  return {
    name,
    colors,
    spacing,
    radii,
    typography,
    motion,
    elevation,
    layout,
  };
}

export const darkTheme: Theme = createTheme("dark", darkColors);
export const lightTheme: Theme = createTheme("light", lightColors);

export const themes = {
  dark: darkTheme,
  light: lightTheme,
} as const;

export function getTheme(name: ThemeName): Theme {
  return themes[name];
}

/**
 * Theme-independent token bag + dark colors as default consumer baseline.
 * Prefer `useTheme()` / `getTheme()` in UI for correct light/dark.
 */
export const tokens = {
  colors: darkColors,
  spacing,
  radii,
  typography,
  motion,
  elevation,
  layout,
} as const;

export type DesignTokens = typeof tokens;
