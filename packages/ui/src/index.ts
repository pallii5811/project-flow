export { Box } from "./Box";
export type { BoxProps } from "./Box";

export { Stack } from "./Stack";
export { Row } from "./Row";

export { Text } from "./Text";
export type { AppTextProps } from "./Text";

export { Icon } from "./Icon";
export { Pressable } from "./Pressable";
export type { AppPressableProps } from "./Pressable";

export { Divider } from "./Divider";
export { Spacer } from "./Spacer";
export { Surface } from "./Surface";
export { GradientOverlay } from "./GradientOverlay";
export { SafeArea } from "./SafeArea";
export { Screen } from "./Screen";

export { ThemeProvider, useTheme, useThemeControls } from "./theme";

/** @deprecated Prompt A scaffold — prefer tokens via useTheme() */
export const uiFoundation = {
  packageName: "@project-flow/ui",
} as const;
