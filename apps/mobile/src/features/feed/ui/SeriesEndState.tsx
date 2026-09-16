import type { ReactElement } from "react";
import { View } from "react-native";

import { Pressable, Text, useTheme } from "@project-flow/ui";

type SeriesEndStateProps = {
  seriesTitle: string;
  onDismiss: () => void;
};

/** Minimal end-of-series surface — no fake recommendations. */
export function SeriesEndState({
  seriesTitle,
  onDismiss,
}: SeriesEndStateProps): ReactElement {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Episode complete. End of ${seriesTitle}`}
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
      <Text variant="caption" style={{ color: theme.colors.foregroundMuted }}>
        Episode complete
      </Text>
      <Text variant="titleSmall" style={{ color: theme.colors.foreground }}>
        {seriesTitle}
      </Text>
      <Text variant="bodySmall" style={{ color: theme.colors.foregroundMuted }}>
        You finished this story.
      </Text>
      <Pressable
        accessibilityLabel="Keep watching feed"
        onPress={onDismiss}
        style={{
          alignSelf: "flex-start",
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radii.md,
          backgroundColor: theme.colors.surfaceElevated,
          marginTop: theme.spacing.xs,
        }}
      >
        <Text
          variant="labelLarge"
          style={{ color: theme.colors.foreground, textAlign: "center" }}
        >
          Keep watching
        </Text>
      </Pressable>
    </View>
  );
}
