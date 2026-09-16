import type { ReactElement } from "react";
import { View } from "react-native";

import { Pressable, Text, useTheme } from "@project-flow/ui";

type ContinueStripProps = {
  seriesTitle: string;
  episodeLabel: string;
  onContinue: () => void;
  /** Future-facing only — not wired in Prompt D */
  showFutureAffordances?: boolean;
};

/**
 * S2 — overlay, not a destination screen.
 * Appears only when resume/explicit continue is needed.
 */
export function ContinueStrip({
  seriesTitle,
  episodeLabel,
  onContinue,
  showFutureAffordances = false,
}: ContinueStripProps): ReactElement {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Continue story: ${seriesTitle}`}
      style={{
        position: "absolute",
        left: theme.spacing.md,
        right: theme.spacing.md,
        bottom: theme.spacing["3xl"],
        padding: theme.spacing.md,
        borderRadius: theme.radii.md,
        backgroundColor: theme.colors.overlay,
        gap: theme.spacing.sm,
        zIndex: 15,
      }}
    >
      <Text variant="caption" tone="subtle" style={{ color: theme.colors.foregroundMuted }}>
        Continue story
      </Text>
      <Text variant="titleSmall" style={{ color: theme.colors.foreground }}>
        {seriesTitle}
      </Text>
      <Text variant="bodySmall" style={{ color: theme.colors.foregroundMuted }}>
        {episodeLabel}
      </Text>
      <Pressable
        accessibilityLabel="Continue episode"
        onPress={onContinue}
        style={{
          alignSelf: "flex-start",
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radii.md,
          backgroundColor: theme.colors.accent,
          marginTop: theme.spacing.xs,
        }}
      >
        <Text
          variant="labelLarge"
          style={{ color: theme.colors.accentForeground, textAlign: "center" }}
        >
          Continue
        </Text>
      </Pressable>
      {showFutureAffordances ? (
        <View style={{ flexDirection: "row", gap: theme.spacing.sm, opacity: 0.45 }}>
          <Text variant="caption" style={{ color: theme.colors.foregroundSubtle }}>
            More like this
          </Text>
          <Text variant="caption" style={{ color: theme.colors.foregroundSubtle }}>
            Surprise me
          </Text>
        </View>
      ) : null}
    </View>
  );
}
