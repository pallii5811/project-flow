import type { ReactElement, ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "./theme";

type IconProps = {
  /** Optical size in pt. Hit area expands to layout.minTouchTarget when pressable parent needs it. */
  size?: "sm" | "md" | "lg" | number;
  color?: string;
  accessibilityLabel?: string;
  /** When true, hide from screen readers (parent already labeled). */
  decorative?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Icon shell — consistent optical sizing + a11y.
 * Pass platform/vector glyphs as children; no decorative icon kit.
 */
export function Icon({
  size = "md",
  color,
  accessibilityLabel,
  decorative = false,
  children,
  style,
}: IconProps): ReactElement {
  const theme = useTheme();
  const resolvedSize =
    size === "sm"
      ? theme.layout.iconSm
      : size === "md"
        ? theme.layout.iconMd
        : size === "lg"
          ? theme.layout.iconLg
          : size;

  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : "image"}
      accessibilityLabel={decorative ? undefined : accessibilityLabel}
      style={[
        {
          width: resolvedSize,
          height: resolvedSize,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      {children ?? (
        <View
          style={{
            width: resolvedSize * 0.55,
            height: resolvedSize * 0.55,
            borderRadius: theme.radii.sm,
            backgroundColor: color ?? theme.colors.foregroundMuted,
          }}
        />
      )}
    </View>
  );
}
