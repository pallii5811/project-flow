import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { AccessibilityInfo, ScrollView, View } from "react-native";

import {
  Divider,
  GradientOverlay,
  Pressable,
  Row,
  Screen,
  Spacer,
  Stack,
  Surface,
  Text,
  useTheme,
  useThemeControls,
} from "@project-flow/ui";

/**
 * DEV-ONLY validation surface for the design system.
 * Not a consumer product screen.
 */
export function DesignSystemShowcase(): ReactElement {
  const theme = useTheme();
  const { themeName, setThemeName } = useThemeControls();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <Screen testID="design-system-showcase" style={{ paddingHorizontal: 0 }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenMargin,
          paddingBottom: theme.spacing["4xl"],
          gap: theme.spacing.lg,
        }}
      >
        <Stack gap="xs">
          <Text variant="caption" tone="subtle">
            DEV · DESIGN SYSTEM
          </Text>
          <Text variant="headlineMedium">PROJECT FLOW</Text>
          <Text variant="bodyMedium" tone="muted">
            Cinematic tokens and primitives. Not the product feed.
          </Text>
        </Stack>

        <Row gap="sm">
          <Pressable
            accessibilityLabel="Use dark theme"
            onPress={() => setThemeName("dark")}
            style={{
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radii.md,
              backgroundColor:
                themeName === "dark"
                  ? theme.colors.accent
                  : theme.colors.surfaceElevated,
            }}
          >
            <Text
              variant="labelMedium"
              style={{
                color:
                  themeName === "dark"
                    ? theme.colors.accentForeground
                    : theme.colors.foreground,
                textAlign: "center",
              }}
            >
              Dark
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Use light theme"
            onPress={() => setThemeName("light")}
            style={{
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radii.md,
              backgroundColor:
                themeName === "light"
                  ? theme.colors.accent
                  : theme.colors.surfaceElevated,
            }}
          >
            <Text
              variant="labelMedium"
              style={{
                color:
                  themeName === "light"
                    ? theme.colors.accentForeground
                    : theme.colors.foreground,
                textAlign: "center",
              }}
            >
              Light
            </Text>
          </Pressable>
        </Row>

        <Divider />

        <Stack gap="sm">
          <Text variant="titleSmall">Typography</Text>
          {(
            [
              "display",
              "headlineLarge",
              "headlineMedium",
              "headlineSmall",
              "titleLarge",
              "titleMedium",
              "titleSmall",
              "bodyLarge",
              "bodyMedium",
              "bodySmall",
              "labelLarge",
              "labelMedium",
              "caption",
            ] as const
          ).map((variant) => (
            <Text key={variant} variant={variant}>
              {variant} · The story starts now
            </Text>
          ))}
        </Stack>

        <Divider />

        <Stack gap="sm">
          <Text variant="titleSmall">Colors</Text>
          <ColorRow name="background" value={theme.colors.background} />
          <ColorRow name="surface" value={theme.colors.surface} />
          <ColorRow name="accent" value={theme.colors.accent} />
          <ColorRow name="danger" value={theme.colors.danger} />
          <ColorRow name="success" value={theme.colors.success} />
        </Stack>

        <Divider />

        <Stack gap="sm">
          <Text variant="titleSmall">Spacing</Text>
          <Row gap="xs" align="flex-end" style={{ flexWrap: "wrap" }}>
            {(["xs", "sm", "md", "lg", "xl", "2xl"] as const).map((token) => (
              <View key={token} style={{ alignItems: "center" }}>
                <View
                  style={{
                    width: theme.spacing[token],
                    height: theme.spacing[token],
                    backgroundColor: theme.colors.accent,
                    opacity: 0.85,
                  }}
                />
                <Text variant="caption" tone="subtle">
                  {token}
                </Text>
              </View>
            ))}
          </Row>
        </Stack>

        <Divider />

        <Stack gap="sm">
          <Text variant="titleSmall">Radii</Text>
          <Row gap="md">
            {(["none", "sm", "md", "lg", "xl"] as const).map((token) => (
              <View
                key={token}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: theme.radii[token],
                  backgroundColor: theme.colors.surfaceElevated,
                  borderWidth: theme.layout.hairline,
                  borderColor: theme.colors.border,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text variant="caption">{token}</Text>
              </View>
            ))}
          </Row>
        </Stack>

        <Divider />

        <Stack gap="sm">
          <Text variant="titleSmall">Motion</Text>
          <Text variant="bodySmall" tone="muted">
            instant {theme.motion.duration.instant}ms · fast{" "}
            {theme.motion.duration.fast}ms · normal {theme.motion.duration.normal}
            ms · deliberate {theme.motion.duration.deliberate}ms
          </Text>
          <Text variant="bodySmall" tone="muted">
            Reduced motion: {reduceMotion ? "on — prefer instant/crossfade" : "off"}
          </Text>
          <Pressable
            accessibilityLabel="Example pressable"
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: theme.spacing.lg,
              borderRadius: theme.radii.md,
              backgroundColor: theme.colors.accent,
            }}
          >
            <Text
              variant="labelLarge"
              style={{ color: theme.colors.accentForeground, textAlign: "center" }}
            >
              Press state
            </Text>
          </Pressable>
        </Stack>

        <Divider />

        <Stack gap="sm">
          <Text variant="titleSmall">Overlay / scrim</Text>
          <Surface
            radius="md"
            style={{
              height: 180,
              overflow: "hidden",
              backgroundColor: theme.colors.backgroundElevated,
            }}
          >
            <View style={{ flex: 1, justifyContent: "center", padding: theme.spacing.md }}>
              <Text variant="titleMedium">Content under scrim</Text>
              <Text variant="bodySmall" tone="muted">
                Readable text treatment for future video edges.
              </Text>
            </View>
            <GradientOverlay position="top" intensity="soft" />
            <GradientOverlay position="bottom" intensity="strong" />
          </Surface>
        </Stack>

        <Divider />

        <Stack gap="sm">
          <Text variant="titleSmall">Accessibility</Text>
          <Text variant="bodySmall" tone="muted">
            Touch targets ≥ {theme.layout.minTouchTarget}pt. Color is never the only
            signal — labels accompany status. Dynamic Type: prefer variant tokens, not
            fixed px in product UI.
          </Text>
          <Row gap="sm">
            <Text variant="labelMedium" tone="danger">
              Error
            </Text>
            <Text variant="caption" tone="muted">
              + text, not color alone
            </Text>
          </Row>
        </Stack>

        <Spacer size="xl" />
      </ScrollView>
    </Screen>
  );
}

function ColorRow({ name, value }: { name: string; value: string }): ReactElement {
  const theme = useTheme();
  return (
    <Row gap="sm">
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: theme.radii.sm,
          backgroundColor: value,
          borderWidth: theme.layout.hairline,
          borderColor: theme.colors.border,
        }}
      />
      <Stack gap="none" style={{ flex: 1 }}>
        <Text variant="labelMedium">{name}</Text>
        <Text variant="caption" tone="subtle">
          {value}
        </Text>
      </Stack>
    </Row>
  );
}
