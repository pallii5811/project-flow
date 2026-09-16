import {
  darkTheme,
  type Theme,
  type ThemeName,
} from "@project-flow/design-system";
import {
  createContext,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react";

type ThemeContextValue = {
  theme: Theme;
  themeName: ThemeName;
  setThemeName: (name: ThemeName) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

type ThemeProviderProps = {
  theme: Theme;
  themeName: ThemeName;
  onThemeNameChange?: (name: ThemeName) => void;
  children: ReactNode;
};

/** Minimal theme bridge — no heavy theme framework. */
export function ThemeProvider({
  theme,
  themeName,
  onThemeNameChange,
  children,
}: ThemeProviderProps): ReactElement {
  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      themeName,
      setThemeName: (name) => {
        onThemeNameChange?.(name);
      },
    }),
    [theme, themeName, onThemeNameChange],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  return ctx?.theme ?? darkTheme;
}

export function useThemeControls(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    return {
      theme: darkTheme,
      themeName: "dark",
      setThemeName: () => undefined,
    };
  }
  return ctx;
}
