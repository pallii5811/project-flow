import type { TypographyToken } from "@project-flow/design-system";
import type { ReactElement, ReactNode } from "react";
import {
  Text as RNText,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
} from "react-native";

import { useTheme } from "./theme";

type Tone = "default" | "muted" | "subtle" | "accent" | "danger";

export type AppTextProps = RNTextProps & {
  children?: ReactNode;
  variant?: TypographyToken;
  tone?: Tone;
  style?: StyleProp<TextStyle>;
};

export function Text({
  children,
  variant = "bodyMedium",
  tone = "default",
  style,
  ...rest
}: AppTextProps): ReactElement {
  const theme = useTheme();
  const typeStyle = theme.typography[variant];

  const color =
    tone === "muted"
      ? theme.colors.foregroundMuted
      : tone === "subtle"
        ? theme.colors.foregroundSubtle
        : tone === "accent"
          ? theme.colors.accent
          : tone === "danger"
            ? theme.colors.danger
            : theme.colors.foreground;

  return (
    <RNText
      style={[
        {
          color,
          fontSize: typeStyle.fontSize,
          lineHeight: typeStyle.lineHeight,
          fontWeight: typeStyle.fontWeight,
          letterSpacing: typeStyle.letterSpacing,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}
