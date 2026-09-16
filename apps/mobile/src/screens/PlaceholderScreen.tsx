import { Pressable, Screen, Text } from "@project-flow/ui";
import type { ReactElement } from "react";

type PlaceholderScreenProps = {
  onOpenDesignSystem?: () => void;
};

/** Minimal boot screen — not product UI. */
export function PlaceholderScreen({
  onOpenDesignSystem,
}: PlaceholderScreenProps): ReactElement {
  return (
    <Screen style={{ justifyContent: "center", alignItems: "center" }}>
      <Text variant="headlineSmall">PROJECT FLOW</Text>
      {onOpenDesignSystem ? (
        <Pressable
          accessibilityLabel="Open design system showcase"
          onPress={onOpenDesignSystem}
          style={{ marginTop: 24 }}
        >
          <Text variant="labelMedium" tone="muted">
            Design system
          </Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}
