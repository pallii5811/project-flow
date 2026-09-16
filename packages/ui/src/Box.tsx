import type { SpacingToken } from "@project-flow/design-system";
import type { ReactElement, ReactNode } from "react";
import { View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

import { useTheme } from "./theme";

export type BoxProps = ViewProps & {
  children?: ReactNode;
  padding?: SpacingToken;
  paddingX?: SpacingToken;
  paddingY?: SpacingToken;
  gap?: SpacingToken;
  style?: StyleProp<ViewStyle>;
};

export function Box({
  children,
  padding,
  paddingX,
  paddingY,
  gap,
  style,
  ...rest
}: BoxProps): ReactElement {
  const { spacing } = useTheme();

  const resolved: ViewStyle = {
    ...(padding !== undefined ? { padding: spacing[padding] } : {}),
    ...(paddingX !== undefined
      ? { paddingHorizontal: spacing[paddingX] }
      : {}),
    ...(paddingY !== undefined ? { paddingVertical: spacing[paddingY] } : {}),
    ...(gap !== undefined ? { gap: spacing[gap] } : {}),
  };

  return (
    <View style={[resolved, style]} {...rest}>
      {children}
    </View>
  );
}
