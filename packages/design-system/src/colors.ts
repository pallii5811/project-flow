/**
 * Semantic color tokens — intent over raw hex.
 * Hierarchy comes from contrast, scale, spacing, opacity, type — not many accents.
 */

export type ColorTokens = {
  /** App canvas / root background */
  background: string;
  /** Slightly lifted canvas (e.g. secondary stacks) */
  backgroundElevated: string;
  /** Contained surface (rarely used — prefer composition over cards) */
  surface: string;
  /** Raised surface for transient UI */
  surfaceElevated: string;
  /** Primary text / icons on background */
  foreground: string;
  /** Secondary text */
  foregroundMuted: string;
  /** Tertiary / hint text */
  foregroundSubtle: string;
  /** Strong separators */
  border: string;
  /** Hairline / quiet separators */
  borderSubtle: string;
  /** Single restrained accent (CTAs, focus) — not brand rainbow */
  accent: string;
  /** Text/icon on accent fills */
  accentForeground: string;
  success: string;
  warning: string;
  danger: string;
  /** Full-screen dim behind sheets/modals */
  overlay: string;
  /** Scrim stop color for video-readable overlays (usually black/white) */
  scrim: string;
};

/** Dark is the primary consumer experience — cinematic near-black, warm neutrals. */
export const darkColors: ColorTokens = {
  background: "#0B0B0C",
  backgroundElevated: "#141416",
  surface: "#1C1C1F",
  surfaceElevated: "#26262A",
  foreground: "#F4F3F1",
  foregroundMuted: "#A8A69F",
  foregroundSubtle: "#6F6D67",
  border: "#2E2E32",
  borderSubtle: "#1F1F22",
  accent: "#E8DCC8",
  accentForeground: "#141210",
  success: "#7DAB8A",
  warning: "#C4A35A",
  danger: "#C4736B",
  overlay: "rgba(0, 0, 0, 0.64)",
  scrim: "#000000",
};

/** Light remains intentional — warm paper, not a washed invert. */
export const lightColors: ColorTokens = {
  background: "#F5F3EF",
  backgroundElevated: "#EFECE6",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  foreground: "#161513",
  foregroundMuted: "#5C5A55",
  foregroundSubtle: "#8A8780",
  border: "#D9D5CE",
  borderSubtle: "#E8E4DC",
  accent: "#1A1917",
  accentForeground: "#F5F3EF",
  success: "#2F6B45",
  warning: "#8A6A1F",
  danger: "#9B3F38",
  overlay: "rgba(22, 21, 19, 0.48)",
  scrim: "#000000",
};
