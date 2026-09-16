import type { ReactElement } from "react";
import { View } from "react-native";

/**
 * Minimal geometric feed glyphs — no icon framework.
 * Optical size ~20–22pt inside 44pt hit targets.
 */
type GlyphProps = {
  color: string;
  active?: boolean;
  size?: number;
};

export function LikeGlyph({ color, active = false, size = 22 }: GlyphProps): ReactElement {
  const arm = size * 0.42;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: arm,
          height: arm,
          borderRadius: arm / 2,
          backgroundColor: active ? color : "transparent",
          borderWidth: active ? 0 : 1.6,
          borderColor: color,
          position: "absolute",
          left: size * 0.12,
          top: size * 0.14,
        }}
      />
      <View
        style={{
          width: arm,
          height: arm,
          borderRadius: arm / 2,
          backgroundColor: active ? color : "transparent",
          borderWidth: active ? 0 : 1.6,
          borderColor: color,
          position: "absolute",
          right: size * 0.12,
          top: size * 0.14,
        }}
      />
      <View
        style={{
          width: size * 0.52,
          height: size * 0.52,
          backgroundColor: active ? color : "transparent",
          borderWidth: active ? 0 : 1.6,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
          position: "absolute",
          top: size * 0.28,
        }}
      />
    </View>
  );
}

export function FollowGlyph({ color, active = false, size = 22 }: GlyphProps): ReactElement {
  const bar = size * 0.12;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.6,
        borderColor: color,
        backgroundColor: active ? "rgba(255,255,255,0.12)" : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          position: "absolute",
          width: size * 0.42,
          height: bar,
          backgroundColor: color,
          borderRadius: bar,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: bar,
          height: size * 0.42,
          backgroundColor: color,
          borderRadius: bar,
        }}
      />
    </View>
  );
}

export function ShareGlyph({ color, size = 22 }: GlyphProps): ReactElement {
  const r = size * 0.14;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          position: "absolute",
          top: size * 0.12,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: size * 0.12,
          left: size * 0.12,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: size * 0.12,
          right: size * 0.12,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.28,
          left: size * 0.28,
          width: size * 0.28,
          height: 1.5,
          backgroundColor: color,
          transform: [{ rotate: "-35deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.28,
          right: size * 0.28,
          width: size * 0.28,
          height: 1.5,
          backgroundColor: color,
          transform: [{ rotate: "35deg" }],
        }}
      />
    </View>
  );
}

export function MuteGlyph({ color, muted = false, size = 22 }: GlyphProps & { muted?: boolean }): ReactElement {
  return (
    <View style={{ width: size, height: size, justifyContent: "center" }}>
      <View
        style={{
          width: size * 0.34,
          height: size * 0.34,
          backgroundColor: color,
          borderTopLeftRadius: 2,
          borderBottomLeftRadius: 2,
          marginLeft: size * 0.08,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.32,
          width: 0,
          height: 0,
          borderTopWidth: size * 0.28,
          borderBottomWidth: size * 0.28,
          borderLeftWidth: size * 0.32,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: color,
        }}
      />
      {!muted ? (
        <>
          <View
            style={{
              position: "absolute",
              right: size * 0.08,
              width: size * 0.18,
              height: size * 0.18,
              borderRadius: size,
              borderWidth: 1.5,
              borderColor: color,
              opacity: 0.85,
            }}
          />
          <View
            style={{
              position: "absolute",
              right: 0,
              width: size * 0.32,
              height: size * 0.32,
              borderRadius: size,
              borderWidth: 1.5,
              borderColor: color,
              opacity: 0.45,
            }}
          />
        </>
      ) : (
        <View
          style={{
            position: "absolute",
            right: size * 0.02,
            width: size * 0.55,
            height: 1.6,
            backgroundColor: color,
            transform: [{ rotate: "-42deg" }],
          }}
        />
      )}
    </View>
  );
}

export function CaptionsGlyph({ color, active = false, size = 22 }: GlyphProps): ReactElement {
  return (
    <View
      style={{
        width: size * 1.15,
        height: size * 0.72,
        borderRadius: 3,
        borderWidth: 1.5,
        borderColor: color,
        backgroundColor: active ? "rgba(255,255,255,0.14)" : "transparent",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 2,
      }}
    >
      <View style={{ width: size * 0.22, height: 2, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: size * 0.22, height: 2, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

/** “Shape what comes next” — not labeled Steer. */
export function TuneGlyph({ color, size = 22 }: GlyphProps): ReactElement {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: size * 0.22,
          height: size * 0.22,
          borderRadius: size,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: size * 0.08,
          width: size * 0.1,
          height: size * 0.1,
          borderRadius: size,
          backgroundColor: color,
          opacity: 0.7,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: size * 0.1,
          left: size * 0.18,
          width: size * 0.12,
          height: size * 0.12,
          borderRadius: size,
          backgroundColor: color,
          opacity: 0.7,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: size * 0.1,
          right: size * 0.18,
          width: size * 0.12,
          height: size * 0.12,
          borderRadius: size,
          backgroundColor: color,
          opacity: 0.7,
        }}
      />
    </View>
  );
}
