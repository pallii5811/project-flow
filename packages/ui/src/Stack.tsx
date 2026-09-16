import type { SpacingToken } from "@project-flow/design-system";
import type { ReactElement, ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { Box } from "./Box";

type StackProps = {
  children?: ReactNode;
  gap?: SpacingToken;
  align?: ViewStyle["alignItems"];
  style?: StyleProp<ViewStyle>;
};

export function Stack({
  children,
  gap = "sm",
  align = "stretch",
  style,
}: StackProps): ReactElement {
  return (
    <Box gap={gap} style={[{ flexDirection: "column", alignItems: align }, style]}>
      {children}
    </Box>
  );
}
