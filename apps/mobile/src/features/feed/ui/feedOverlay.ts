/**
 * Feed media overlays are always light-on-dark over video,
 * regardless of app light/dark theme (light theme text would vanish).
 */
export const feedOverlay = {
  text: "#F7F5F2",
  textMuted: "rgba(247,245,242,0.78)",
  textSubtle: "rgba(247,245,242,0.55)",
  accent: "#E8DCC8",
  railWell: "rgba(0,0,0,0.42)",
  progressTrack: "rgba(255,255,255,0.22)",
  progressFill: "rgba(247,245,242,0.95)",
  mediaBed: "#050505",
} as const;
