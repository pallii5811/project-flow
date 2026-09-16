import type { ReactElement, ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { SafeArea } from "./SafeArea";
import { useTheme } from "./theme";

type ScreenProps = {
  children?: ReactNode;
  /** When false, fills edge-to-edge (future video). Default true for tools/showcase. */
  safe?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Screen({
  children,
  safe = true,
  style,
  testID,
}: ScreenProps): ReactElement {
  const theme = useTheme();
  const body = (
    <View
      testID={testID}
      style={[
        {
          flex: 1,
          backgroundColor: theme.colors.background,
          paddingHorizontal: theme.layout.screenMargin,
        },
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!safe) {
    return body;
  }

  return <SafeArea>{body}</SafeArea>;
}
