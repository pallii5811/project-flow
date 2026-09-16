import type { ReactElement, ReactNode } from "react";
import {
  Pressable as RNPressable,
  type PressableProps as RNPressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useTheme } from "./theme";

export type AppPressableProps = Omit<RNPressableProps, "children" | "style"> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Expand hit area to at least minTouchTarget without changing visuals. */
  ensureMinTouchTarget?: boolean;
};

export function Pressable({
  children,
  style,
  ensureMinTouchTarget = true,
  accessibilityRole = "button",
  ...rest
}: AppPressableProps): ReactElement {
  const theme = useTheme();
  const min = theme.layout.minTouchTarget;

  return (
    <RNPressable
      accessibilityRole={accessibilityRole}
      hitSlop={
        ensureMinTouchTarget
          ? { top: 8, bottom: 8, left: 8, right: 8 }
          : undefined
      }
      style={(state) => [
        ensureMinTouchTarget
          ? { minWidth: min, minHeight: min, justifyContent: "center" as const }
          : null,
        { opacity: state.pressed ? 0.72 : 1 },
        style,
      ]}
      {...rest}
    >
      {children}
    </RNPressable>
  );
}
