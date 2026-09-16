import type { ReactElement, ReactNode } from "react";
import {
  SafeAreaView,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useTheme } from "./theme";

type SafeAreaProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function SafeArea({ children, style }: SafeAreaProps): ReactElement {
  const theme = useTheme();
  return (
    <SafeAreaView
      style={[{ flex: 1, backgroundColor: theme.colors.background }, style]}
    >
      {children}
    </SafeAreaView>
  );
}
