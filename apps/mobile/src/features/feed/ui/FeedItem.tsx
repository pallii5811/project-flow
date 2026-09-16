import type { ReactElement } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { GradientOverlay, Text, useTheme } from "@project-flow/ui";

import type { ContentItem } from "../model/types";
import { PlayerSurface } from "../player/PlayerSurface";
import type { PlaybackState } from "../player/playbackState";
import { FeedControls } from "./FeedControls";
import { feedOverlay } from "./feedOverlay";
import { formatEpisodeLabel } from "./feedPresentation";

type FeedItemProps = {
  item: ContentItem;
  height: number;
  active: boolean;
  prepared: boolean;
  muted: boolean;
  liked: boolean;
  following: boolean;
  captionsOn: boolean;
  shouldPlay: boolean;
  progress: number;
  playbackState: PlaybackState;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onToggleLike: () => void;
  onToggleFollow: () => void;
  onShare: () => void;
  onToggleCaptions: () => void;
  onStateChange: (state: PlaybackState) => void;
  onProgress: (positionMs: number, durationMs: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
  initialPositionMs?: number;
  onReady?: () => void;
  intentEnabled?: boolean;
  onOpenIntent?: () => void;
};

export function FeedItem({
  item,
  height,
  active,
  prepared,
  muted,
  liked,
  following,
  captionsOn,
  shouldPlay,
  progress,
  playbackState,
  onTogglePlay,
  onToggleMute,
  onToggleLike,
  onToggleFollow,
  onShare,
  onToggleCaptions,
  onStateChange,
  onProgress,
  onEnded,
  onError,
  initialPositionMs = 0,
  onReady,
  intentEnabled = false,
  onOpenIntent,
}: FeedItemProps): ReactElement {
  const theme = useTheme();
  const showCaption = captionsOn && item.captionsAvailable && item.captionText;
  const awaitingMedia =
    !prepared ||
    playbackState === "idle" ||
    playbackState === "loading" ||
    playbackState === "buffering";
  const videoVisible =
    prepared &&
    (playbackState === "playing" ||
      playbackState === "paused" ||
      playbackState === "ready" ||
      playbackState === "completed");

  return (
    <View
      style={{
        height,
        width: "100%",
        backgroundColor: feedOverlay.mediaBed,
        overflow: "hidden",
      }}
    >
      {/* Always-on cinematic bed + poster (never blank canvas) */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: feedOverlay.mediaBed }]}
        />
        <Image
          source={{ uri: item.thumbnailUrl }}
          accessibilityIgnoresInvertColors
          blurRadius={videoVisible ? 0 : 6}
          resizeMode="cover"
          style={[
            StyleSheet.absoluteFill,
            { opacity: videoVisible ? 0.2 : 0.92 },
          ]}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: videoVisible
                ? "transparent"
                : "rgba(0,0,0,0.22)",
            },
          ]}
        />
      </View>

      {prepared ? (
        <PlayerSurface
          sourceUrl={item.videoUrl}
          active={active}
          muted={muted}
          shouldPlay={shouldPlay && active}
          initialPositionMs={active ? initialPositionMs : 0}
          onStateChange={onStateChange}
          onProgress={onProgress}
          onEnded={onEnded}
          onError={onError}
          onReady={onReady}
        />
      ) : null}

      {awaitingMedia && playbackState !== "error" ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            backgroundColor: "rgba(255,255,255,0.1)",
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: "48%",
              height: "100%",
              backgroundColor: "rgba(255,255,255,0.4)",
            }}
          />
        </View>
      ) : null}

      <GradientOverlay position="top" intensity="soft" height={64} />
      <GradientOverlay position="bottom" intensity="strong" height={240} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shouldPlay ? "Pause video" : "Play video"}
        onPress={onTogglePlay}
        style={{ flex: 1 }}
      />

      {showCaption ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: theme.spacing.lg,
            right: theme.spacing.lg + 56,
            top: "42%",
            alignItems: "center",
          }}
        >
          <Text
            variant="bodyMedium"
            style={{
              color: feedOverlay.text,
              textAlign: "center",
              textShadowColor: "rgba(0,0,0,0.75)",
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 6,
            }}
          >
            {item.captionText}
          </Text>
        </View>
      ) : null}

      {playbackState === "error" ? (
        <View
          pointerEvents="none"
          style={{
            ...StyleSheet.absoluteFill,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: theme.spacing.xl,
          }}
        >
          <Text
            variant="bodyMedium"
            style={{ color: feedOverlay.textMuted, textAlign: "center" }}
          >
            This episode couldn’t play. Swipe for the next story.
          </Text>
        </View>
      ) : null}

      <FeedControls
        seriesTitle={item.seriesTitle}
        hook={item.hook}
        episodeLabel={formatEpisodeLabel(item.episodeNumber)}
        muted={muted}
        liked={liked}
        following={following}
        captionsAvailable={item.captionsAvailable}
        captionsOn={captionsOn}
        progress={progress}
        intentEnabled={intentEnabled}
        onOpenIntent={onOpenIntent}
        onToggleMute={onToggleMute}
        onToggleLike={onToggleLike}
        onToggleFollow={onToggleFollow}
        onShare={onShare}
        onToggleCaptions={onToggleCaptions}
      />
    </View>
  );
}
