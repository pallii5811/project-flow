/**
 * Motion tokens — fast, restrained, never blocking.
 * Prefer fade/crossfade/slide over bounce.
 */
export const motion = {
  duration: {
    instant: 0,
    fast: 120,
    normal: 200,
    deliberate: 320,
  },
  easing: {
    /** Default UI transitions */
    standard: "ease-in-out" as const,
    /** Entering elements */
    enter: "ease-out" as const,
    /** Leaving elements */
    exit: "ease-in" as const,
  },
  /**
   * Conceptual patterns (implement with RN Animated / Reanimated later as needed).
   * Durations reference motion.duration keys.
   */
  patterns: {
    fade: { duration: "fast" as const, easing: "standard" as const },
    scale: { duration: "fast" as const, easing: "enter" as const },
    slide: { duration: "normal" as const, easing: "enter" as const },
    crossfade: { duration: "normal" as const, easing: "standard" as const },
    contentReplace: { duration: "fast" as const, easing: "standard" as const },
    press: { duration: "instant" as const, easing: "standard" as const },
    loading: { duration: "deliberate" as const, easing: "standard" as const },
    skeleton: { duration: "deliberate" as const, easing: "standard" as const },
    sheet: { duration: "normal" as const, easing: "enter" as const },
  },
} as const;

export type MotionDurationToken = keyof typeof motion.duration;
