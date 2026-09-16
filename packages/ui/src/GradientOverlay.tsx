import type { ReactElement } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "./theme";

type GradientOverlayProps = {
  /** Edge that should become most opaque */
  position: "top" | "bottom";
  intensity?: "soft" | "strong";
  height?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Video-readable scrim primitive without a gradient library.
 * Layered opacity stops approximate a soft cinematic falloff.
 */
export function GradientOverlay({
  position,
  intensity = "soft",
  height,
  style,
}: GradientOverlayProps): ReactElement {
  const theme = useTheme();
  const band =
    height ??
    (position === "top" ? theme.layout.scrimTop : theme.layout.scrimBottom);
  const peak = intensity === "strong" ? 0.78 : 0.55;
  const stops = [0.05, 0.18, 0.36, peak];
  const ordered = position === "top" ? [...stops].reverse() : stops;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        {
          height: band,
          [position]: 0,
          flexDirection: "column",
        },
        style,
      ]}
    >
      {ordered.map((opacity, index) => (
        <View
          key={`${position}-${index}`}
          style={{
            flex: 1,
            backgroundColor: theme.colors.scrim,
            opacity,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    position: "absolute",
    left: 0,
    right: 0,
  },
});
