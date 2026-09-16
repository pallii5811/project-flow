import type { ReactElement } from "react";
import { useState } from "react";
import { Modal, Pressable as RNPressable, View } from "react-native";

import { Pressable, Text, useTheme } from "@project-flow/ui";

export type DevSurface = "product" | "design-system" | "scene-graph" | "demand-graph";

type DevMenuProps = {
  surface: DevSurface;
  onSelect: (surface: DevSurface) => void;
};

const OPTIONS: { id: DevSurface; label: string }[] = [
  { id: "product", label: "Product feed" },
  { id: "design-system", label: "Design system" },
  { id: "scene-graph", label: "Scene Graph inspector" },
  { id: "demand-graph", label: "Demand Graph inspector" },
];

/**
 * DEV-only: invisible corner long-press opens tools.
 * Never renders consumer-visible badges on the feed.
 */
export function DevMenu({ surface, onSelect }: DevMenuProps): ReactElement | null {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  if (!__DEV__) return null;

  return (
    <>
      <RNPressable
        accessibilityLabel="Open developer menu"
        accessibilityRole="button"
        onLongPress={() => setOpen(true)}
        delayLongPress={450}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 44,
          height: 44,
          zIndex: 40,
          opacity: 0.01,
        }}
      />

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <RNPressable
            accessibilityLabel="Dismiss developer menu"
            onPress={() => setOpen(false)}
            style={{ flex: 1, backgroundColor: theme.colors.overlay }}
          />
          <View
            style={{
              backgroundColor: theme.colors.surfaceElevated,
              paddingHorizontal: theme.spacing.md,
              paddingTop: theme.spacing.md,
              paddingBottom: theme.spacing.xl,
              borderTopLeftRadius: theme.radii.lg,
              borderTopRightRadius: theme.radii.lg,
              gap: theme.spacing.xs,
            }}
          >
            <Text variant="caption" tone="muted">
              Developer
            </Text>
            {OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                accessibilityLabel={opt.label}
                onPress={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
                style={{
                  minHeight: theme.layout.minTouchTarget,
                  justifyContent: "center",
                  paddingHorizontal: theme.spacing.sm,
                  borderRadius: theme.radii.md,
                  backgroundColor:
                    surface === opt.id ? theme.colors.surface : "transparent",
                }}
              >
                <Text
                  variant="labelLarge"
                  style={{
                    color:
                      surface === opt.id
                        ? theme.colors.accent
                        : theme.colors.foreground,
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}
