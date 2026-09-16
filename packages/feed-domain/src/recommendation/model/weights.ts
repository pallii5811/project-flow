/**
 * Recommendation V0 signal weights — explicit, tunable, NOT ML.
 *
 * Philosophy:
 * - Completion / continue / like / follow beat impressions.
 * - Immediate skip is strongly negative.
 * - view_start is weak/noisy and barely moves affinity.
 */

export const SIGNAL_WEIGHTS = {
  complete: 1.2,
  continue: 1.0,
  like: 1.6,
  follow: 1.4,
  replay: 0.8,
  skipImmediate: -1.5,
  skipEarly: -0.9,
  skipRepeated: -0.6,
  viewStart: 0.05,
  watchDurationSoft: 0.2,
} as const;

/** Ranking feature weights (sum roughly ~1 before penalties). */
export const RANK_WEIGHTS = {
  genre: 0.28,
  trope: 0.18,
  series: 0.22,
  language: 0.12,
  recent: 0.1,
  completion: 0.08,
  editorial: 0.06,
  popularity: 0.08,
  skipPenalty: 0.35,
} as const;

/** Half-life for affinity decay (ms). ~14 days. */
export const AFFINITY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

export const HISTORY_LIMIT = 80;
export const SKIP_HISTORY_LIMIT = 40;

/** Max consecutive same-series items when diversity is on (continuation exempt). */
export const MAX_CONSECUTIVE_SAME_SERIES = 1;

/** Exploration: every Nth non-continuation slot may inject exploration. */
export const EXPLORATION_EVERY_N = 5;

export const IMMEDIATE_SKIP_PCT = 15;
export const EARLY_ABANDON_PCT = 40;
