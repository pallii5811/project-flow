import type { SpacingToken } from "@project-flow/design-system";
import type { ReactElement, ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { Box } from "./Box";

type RowProps = {
  children?: ReactNode;
  gap?: SpacingToken;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  style?: StyleProp<ViewStyle>;
};

export function Row({
  children,
  gap = "sm",
  align = "center",
  justify = "flex-start",
  style,
}: RowProps): ReactElement {
  return (
    <Box
      gap={gap}
      style={[
        {
          flexDirection: "row",
          alignItems: align,
          justifyContent: justify,
        },
        style,
      ]}
    >
      {children}
    </Box>
  );
}
