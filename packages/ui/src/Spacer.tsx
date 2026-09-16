import type { SpacingToken } from "@project-flow/design-system";
import type { ReactElement } from "react";
import { View } from "react-native";

import { useTheme } from "./theme";

type SpacerProps = {
  size?: SpacingToken;
  flex?: number;
};

export function Spacer({ size = "md", flex }: SpacerProps): ReactElement {
  const { spacing } = useTheme();
  if (flex !== undefined) {
    return <View style={{ flex }} />;
  }
  return <View style={{ width: spacing[size], height: spacing[size] }} />;
}
