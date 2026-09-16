import type { ReactElement } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "./theme";

type DividerProps = {
  subtle?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Divider({ subtle = true, style }: DividerProps): ReactElement {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="none"
      style={[
        {
          height: theme.layout.hairline,
          backgroundColor: subtle
            ? theme.colors.borderSubtle
            : theme.colors.border,
          alignSelf: "stretch",
        },
        style,
      ]}
    />
  );
}
