import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { Icon, Pressable, Text, useTheme } from "@project-flow/ui";

import {
  CaptionsGlyph,
  FollowGlyph,
  LikeGlyph,
  MuteGlyph,
  ShareGlyph,
  TuneGlyph,
} from "./FeedIcons";
import { feedOverlay } from "./feedOverlay";

type FeedControlsProps = {
  seriesTitle: string;
  hook: string;
  episodeLabel: string | null;
  muted: boolean;
  liked: boolean;
  following: boolean;
  captionsAvailable: boolean;
  captionsOn: boolean;
  progress: number;
  intentEnabled?: boolean;
  onOpenIntent?: () => void;
  onToggleMute: () => void;
  onToggleLike: () => void;
  onToggleFollow: () => void;
  onShare: () => void;
  onToggleCaptions: () => void;
};

export function FeedControls({
  seriesTitle,
  hook,
  episodeLabel,
  muted,
  liked,
  following,
  captionsAvailable,
  captionsOn,
  progress,
  intentEnabled = false,
  onOpenIntent,
  onToggleMute,
  onToggleLike,
  onToggleFollow,
  onShare,
  onToggleCaptions,
}: FeedControlsProps): ReactElement {
  const theme = useTheme();
  const progressPct = Math.min(100, Math.max(0, progress * 100));

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        justifyContent: "flex-end",
        paddingHorizontal: theme.spacing.md,
        paddingBottom: theme.spacing.lg,
      }}
    >
      <View
        style={{
          position: "absolute",
          right: theme.spacing.sm,
          bottom: theme.spacing["4xl"],
          gap: theme.spacing.md,
          alignItems: "center",
        }}
      >
        <RailAction
          accessibilityLabel={liked ? "Unlike" : "Like"}
          active={liked}
          onPress={onToggleLike}
        >
          <LikeGlyph
            color={liked ? feedOverlay.accent : feedOverlay.text}
            active={liked}
          />
        </RailAction>
        <RailAction
          accessibilityLabel={following ? "Unfollow series" : "Follow series"}
          active={following}
          onPress={onToggleFollow}
        >
          <FollowGlyph
            color={following ? feedOverlay.accent : feedOverlay.text}
            active={following}
          />
        </RailAction>
        <RailAction accessibilityLabel="Share" onPress={onShare}>
          <ShareGlyph color={feedOverlay.text} />
        </RailAction>
        <RailAction
          accessibilityLabel={muted ? "Unmute" : "Mute"}
          onPress={onToggleMute}
        >
          <MuteGlyph color={feedOverlay.text} muted={muted} />
        </RailAction>
        {captionsAvailable ? (
          <RailAction
            accessibilityLabel={captionsOn ? "Hide captions" : "Show captions"}
            active={captionsOn}
            onPress={onToggleCaptions}
          >
            <CaptionsGlyph
              color={captionsOn ? feedOverlay.accent : feedOverlay.text}
              active={captionsOn}
            />
          </RailAction>
        ) : null}
        {intentEnabled && onOpenIntent ? (
          <RailAction
            accessibilityLabel="Tune what comes next"
            onPress={onOpenIntent}
          >
            <TuneGlyph color={feedOverlay.text} />
          </RailAction>
        ) : null}
      </View>

      <View
        pointerEvents="none"
        style={{
          maxWidth: "76%",
          paddingRight: theme.spacing.sm,
          gap: theme.spacing.xs,
          marginBottom: theme.spacing.sm,
        }}
      >
        <Text
          variant="headlineSmall"
          style={{
            color: feedOverlay.text,
            textShadowColor: "rgba(0,0,0,0.65)",
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 10,
          }}
          numberOfLines={2}
        >
          {seriesTitle}
        </Text>
        <Text
          variant="bodyLarge"
          style={{
            color: feedOverlay.text,
            opacity: 0.94,
            textShadowColor: "rgba(0,0,0,0.55)",
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 8,
          }}
          numberOfLines={3}
        >
          {hook}
        </Text>
        {episodeLabel ? (
          <Text
            variant="caption"
            style={{
              color: feedOverlay.textSubtle,
              marginTop: 2,
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
            numberOfLines={1}
          >
            {episodeLabel}
          </Text>
        ) : null}
      </View>

      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progressPct) }}
        style={{
          height: 1.5,
          backgroundColor: feedOverlay.progressTrack,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${progressPct}%`,
            height: "100%",
            backgroundColor: feedOverlay.progressFill,
          }}
        />
      </View>
    </View>
  );
}

function RailAction({
  accessibilityLabel,
  onPress,
  active = false,
  children,
}: {
  accessibilityLabel: string;
  onPress: () => void;
  active?: boolean;
  children: ReactNode;
}): ReactElement {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        width: theme.layout.minTouchTarget,
        height: theme.layout.minTouchTarget,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: feedOverlay.railWell,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: "rgba(255,255,255,0.18)",
        }}
      >
        <Icon size="lg" decorative>
          {children}
        </Icon>
      </View>
    </Pressable>
  );
}
