import type { ReactElement, ReactNode } from "react";
import { Platform, useWindowDimensions, View } from "react-native";

import { useTheme } from "@project-flow/ui";

type DevPhoneFrameProps = {
  children: ReactNode;
};

const MAX_PHONE_WIDTH = 390;
const ASPECT = 9 / 16;

/**
 * DEV-only web shell: centers a realistic 9:16 phone composition.
 * Does not alter native mobile layout (full-screen remains primary).
 */
export function DevPhoneFrame({ children }: DevPhoneFrameProps): ReactElement {
  const theme = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();

  if (!__DEV__ || Platform.OS !== "web") {
    return <>{children}</>;
  }

  const maxH = Math.min(winH - 32, 844);
  const widthFromHeight = maxH * ASPECT;
  const widthFromWindow = Math.min(MAX_PHONE_WIDTH, winW - 48);
  const phoneW = Math.min(widthFromHeight, widthFromWindow);
  const phoneH = phoneW / ASPECT;

  return (
    <View
      style={{
        flex: 1,
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#121214",
      }}
    >
      <View
        style={{
          width: phoneW,
          height: phoneH,
          overflow: "hidden",
          backgroundColor: theme.colors.background,
          borderRadius: 28,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        {children}
      </View>
    </View>
  );
}
