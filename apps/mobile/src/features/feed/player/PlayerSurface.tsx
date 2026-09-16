import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useEventListener } from "expo";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";

import type { PlaybackState } from "./playbackState";
import { reducePlaybackState } from "./playbackState";

export type PlayerSurfaceProps = {
  sourceUrl: string;
  active: boolean;
  muted: boolean;
  shouldPlay: boolean;
  /** Seek once when player becomes ready (resume). */
  initialPositionMs?: number;
  onStateChange: (state: PlaybackState) => void;
  onProgress: (positionMs: number, durationMs: number) => void;
  onEnded: () => void;
  onError: (message: string) => void;
  /** Fired when status reaches readyToPlay (prefetch signal). */
  onReady?: () => void;
};

/**
 * Isolates expo-video behind a narrow feed-facing surface.
 * Only the active item should call play(); neighbors may mount for prefetch.
 */
export function PlayerSurface({
  sourceUrl,
  active,
  muted,
  shouldPlay,
  initialPositionMs = 0,
  onStateChange,
  onProgress,
  onEnded,
  onError,
  onReady,
}: PlayerSurfaceProps): ReactElement {
  const stateRef = useRef<PlaybackState>("idle");
  const recoveredRef = useRef(false);
  const seekAppliedRef = useRef(false);

  const pushState = (event: Parameters<typeof reducePlaybackState>[1]) => {
    const next = reducePlaybackState(stateRef.current, event);
    if (next !== stateRef.current) {
      stateRef.current = next;
      onStateChange(next);
    }
  };

  const source: VideoSource = { uri: sourceUrl };
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    instance.muted = muted;
    instance.timeUpdateEventInterval = 0.25;
    pushState({ type: "LOAD" });
  });

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    seekAppliedRef.current = false;
  }, [sourceUrl]);

  useEffect(() => {
    if (!active) {
      player.pause();
      return;
    }
    if (shouldPlay) {
      pushState({ type: "PLAY" });
      player.play();
    } else {
      player.pause();
      pushState({ type: "PAUSE" });
    }
  }, [active, shouldPlay, player]);

  useEventListener(player, "statusChange", ({ status, error }) => {
    if (status === "loading") {
      pushState({ type: "LOAD" });
      return;
    }
    if (status === "readyToPlay") {
      pushState({ type: "READY" });
      onReady?.();
      if (
        !seekAppliedRef.current &&
        initialPositionMs > 0 &&
        Number.isFinite(player.duration) &&
        (player.duration ?? 0) > 0
      ) {
        seekAppliedRef.current = true;
        player.currentTime = Math.min(
          initialPositionMs / 1000,
          Math.max(0, (player.duration ?? 0) - 0.25),
        );
      }
      if (active && shouldPlay) {
        player.play();
        pushState({ type: "PLAY" });
      }
      return;
    }
    if (status === "error") {
      const message = error?.message ?? "playback_error";
      if (!recoveredRef.current) {
        recoveredRef.current = true;
        void player.replaceAsync(source).catch(() => {
          pushState({ type: "ERROR", message });
          onError(message);
        });
        return;
      }
      pushState({ type: "ERROR", message });
      onError(message);
    }
  });

  useEventListener(player, "playingChange", ({ isPlaying }) => {
    if (isPlaying) {
      pushState({ type: "PLAY" });
    } else if (stateRef.current === "playing") {
      pushState({ type: "PAUSE" });
    }
  });

  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    const durationMs = Math.max(0, (player.duration ?? 0) * 1000);
    onProgress(Math.max(0, currentTime * 1000), durationMs);
  });

  useEventListener(player, "playToEnd", () => {
    pushState({ type: "COMPLETE" });
    onEnded();
  });

  return (
    <View style={styles.fill} pointerEvents="none">
      <VideoView
        style={styles.fill}
        player={player}
        contentFit="cover"
        nativeControls={false}
        fullscreenOptions={{ enable: false }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
  },
});
