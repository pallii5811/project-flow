import type { ElevationToken, RadiusToken } from "@project-flow/design-system";
import type { ReactElement, ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { Box } from "./Box";
import { useTheme } from "./theme";

type SurfaceProps = {
  children?: ReactNode;
  elevated?: boolean;
  radius?: RadiusToken;
  elevation?: ElevationToken;
  style?: StyleProp<ViewStyle>;
};

export function Surface({
  children,
  elevated = false,
  radius = "none",
  elevation: elevationToken = "none",
  style,
}: SurfaceProps): ReactElement {
  const theme = useTheme();
  return (
    <Box
      style={[
        {
          backgroundColor: elevated
            ? theme.colors.surfaceElevated
            : theme.colors.surface,
          borderRadius: theme.radii[radius],
          ...theme.elevation[elevationToken],
        },
        style,
      ]}
    >
      {children}
    </Box>
  );
}
