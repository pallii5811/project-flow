import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Modal,
  Pressable as RNPressable,
  TextInput,
  View,
} from "react-native";

import { Pressable, Text, useTheme } from "@project-flow/ui";

import {
  INTENT_CHIP_IDS,
  INTENT_CHIP_LABELS,
  type IntentChipId,
} from "../model/taxonomy";

type IntentSheetProps = {
  visible: boolean;
  chipsEnabled: boolean;
  nlEnabled: boolean;
  busy?: boolean;
  unresolvedHint?: string | null;
  onClose: () => void;
  onSelectChip: (chipId: IntentChipId) => void;
  onSubmitText?: (text: string) => void;
};

/**
 * S3 — sparse intent overlay/sheet. Not a chatbot. Not a search screen.
 */
export function IntentSheet({
  visible,
  chipsEnabled,
  nlEnabled,
  busy = false,
  unresolvedHint = null,
  onClose,
  onSelectChip,
  onSubmitText,
}: IntentSheetProps): ReactElement {
  const theme = useTheme();
  const [text, setText] = useState("");
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!visible) setText("");
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "slide"}
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <RNPressable
          accessibilityLabel="Dismiss intent sheet"
          onPress={onClose}
          style={{
            flex: 1,
            backgroundColor: theme.colors.overlay,
          }}
        />
        <View
          accessibilityRole="summary"
          accessibilityLabel="What do you want to watch"
          style={{
            backgroundColor: theme.colors.surfaceElevated,
            paddingHorizontal: theme.spacing.md,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.xl,
            borderTopLeftRadius: theme.radii.lg,
            borderTopRightRadius: theme.radii.lg,
            gap: theme.spacing.md,
          }}
        >
          <Text variant="titleSmall">What do you want next?</Text>
          <Text variant="caption" tone="muted">
            Optional. Keep watching anytime.
          </Text>

          {chipsEnabled ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: theme.spacing.sm,
              }}
            >
              {INTENT_CHIP_IDS.map((chipId) => (
                <Pressable
                  key={chipId}
                  accessibilityLabel={INTENT_CHIP_LABELS[chipId]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => onSelectChip(chipId)}
                  style={{
                    minHeight: theme.layout.minTouchTarget,
                    paddingHorizontal: theme.spacing.md,
                    justifyContent: "center",
                    borderRadius: theme.radii.md,
                    backgroundColor: theme.colors.surface,
                  }}
                >
                  <Text variant="labelMedium">{INTENT_CHIP_LABELS[chipId]}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {nlEnabled && onSubmitText ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="caption" tone="muted">
                Or type a short request
              </Text>
              <TextInput
                accessibilityLabel="Intent text request"
                value={text}
                onChangeText={setText}
                editable={!busy}
                placeholder="e.g. more romantic"
                placeholderTextColor={theme.colors.foregroundSubtle}
                onSubmitEditing={() => {
                  if (text.trim()) onSubmitText(text.trim());
                }}
                style={{
                  minHeight: theme.layout.minTouchTarget,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radii.md,
                  backgroundColor: theme.colors.surface,
                  color: theme.colors.foreground,
                }}
              />
            </View>
          ) : null}

          {unresolvedHint ? (
            <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
              {unresolvedHint}
            </Text>
          ) : null}

          <Pressable
            accessibilityLabel="Close"
            onPress={onClose}
            style={{
              minHeight: theme.layout.minTouchTarget,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text variant="labelMedium" tone="muted">
              Close
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
