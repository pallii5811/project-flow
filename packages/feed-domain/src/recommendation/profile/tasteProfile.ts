import {
  AFFINITY_HALF_LIFE_MS,
  HISTORY_LIMIT,
  SIGNAL_WEIGHTS,
  SKIP_HISTORY_LIMIT,
} from "../model/weights";
import type {
  AffinityMap,
  HistoryEntry,
  InteractionAction,
  UserTasteProfile,
} from "../model/types";

export function createEmptyProfile(now = Date.now()): UserTasteProfile {
  return {
    version: 1,
    likedSeries: {},
    likedGenres: {},
    likedTropes: {},
    watchedSeries: {},
    completedSeries: {},
    skippedSeries: {},
    languageAffinity: {},
    completionAffinity: 0,
    engagementAffinity: 0,
    recentHistory: [],
    recentSkips: [],
    interactionCount: 0,
    updatedAt: now,
  };
}

function bump(map: AffinityMap, key: string, delta: number): void {
  map[key] = (map[key] ?? 0) + delta;
}

function pushBounded(list: HistoryEntry[], entry: HistoryEntry, limit: number): void {
  list.unshift(entry);
  if (list.length > limit) {
    list.length = limit;
  }
}

export type ProfileSignalInput = {
  contentId: string;
  seriesId: string;
  genres: string[];
  tropes: string[];
  language: string;
  action: InteractionAction;
  watchDurationMs: number;
  completionPercentage: number;
  now?: number;
};

/**
 * Incremental profile update. One event never fully rewrites taste.
 */
export function applySignal(
  profile: UserTasteProfile,
  input: ProfileSignalInput,
): UserTasteProfile {
  const now = input.now ?? Date.now();
  // Decay from previous update timestamp before applying the new signal.
  const decayed = decayProfile(profile, now);
  const next: UserTasteProfile = {
    ...decayed,
    likedSeries: { ...decayed.likedSeries },
    likedGenres: { ...decayed.likedGenres },
    likedTropes: { ...decayed.likedTropes },
    watchedSeries: { ...decayed.watchedSeries },
    completedSeries: { ...decayed.completedSeries },
    skippedSeries: { ...decayed.skippedSeries },
    languageAffinity: { ...decayed.languageAffinity },
    recentHistory: [...decayed.recentHistory],
    recentSkips: [...decayed.recentSkips],
    updatedAt: now,
    interactionCount: decayed.interactionCount + 1,
  };

  const entry: HistoryEntry = {
    contentId: input.contentId,
    seriesId: input.seriesId,
    genres: input.genres,
    tropes: input.tropes,
    language: input.language,
    timestamp: now,
    action: input.action,
    watchDurationMs: input.watchDurationMs,
    completionPercentage: input.completionPercentage,
  };
  pushBounded(next.recentHistory, entry, HISTORY_LIMIT);

  const applyPositive = (weight: number) => {
    bump(next.watchedSeries, input.seriesId, weight * 0.4);
    bump(next.languageAffinity, input.language, weight * 0.3);
    for (const genre of input.genres) bump(next.likedGenres, genre, weight);
    for (const trope of input.tropes) bump(next.likedTropes, trope, weight * 0.8);
    next.engagementAffinity += weight * 0.05;
  };

  switch (input.action) {
    case "complete":
      applyPositive(SIGNAL_WEIGHTS.complete);
      bump(next.completedSeries, input.seriesId, SIGNAL_WEIGHTS.complete);
      next.completionAffinity += 0.08;
      break;
    case "continue":
      applyPositive(SIGNAL_WEIGHTS.continue);
      bump(next.likedSeries, input.seriesId, SIGNAL_WEIGHTS.continue * 0.5);
      break;
    case "like":
      applyPositive(SIGNAL_WEIGHTS.like);
      bump(next.likedSeries, input.seriesId, SIGNAL_WEIGHTS.like);
      break;
    case "follow":
      applyPositive(SIGNAL_WEIGHTS.follow);
      bump(next.likedSeries, input.seriesId, SIGNAL_WEIGHTS.follow * 1.2);
      break;
    case "replay":
      applyPositive(SIGNAL_WEIGHTS.replay);
      break;
    case "skip": {
      const pct = input.completionPercentage;
      const weight =
        pct <= 15
          ? SIGNAL_WEIGHTS.skipImmediate
          : pct <= 40
            ? SIGNAL_WEIGHTS.skipEarly
            : SIGNAL_WEIGHTS.skipRepeated;
      bump(next.skippedSeries, input.seriesId, Math.abs(weight));
      for (const genre of input.genres) bump(next.likedGenres, genre, weight * 0.5);
      for (const trope of input.tropes) bump(next.likedTropes, trope, weight * 0.4);
      pushBounded(next.recentSkips, entry, SKIP_HISTORY_LIMIT);
      next.engagementAffinity += weight * 0.02;
      break;
    }
    case "view_start":
      applyPositive(SIGNAL_WEIGHTS.viewStart);
      break;
    case "watch_progress":
      if (input.completionPercentage >= 50) {
        applyPositive(SIGNAL_WEIGHTS.watchDurationSoft);
      }
      break;
    default:
      break;
  }

  return next;
}

/**
 * Exponential decay toward zero: value *= 0.5^(age/halfLife)
 * Applied lightly on each update so recent > old.
 */
export function decayProfile(
  profile: UserTasteProfile,
  now = Date.now(),
): UserTasteProfile {
  const age = Math.max(0, now - profile.updatedAt);
  if (age === 0) return profile;
  const factor = Math.pow(0.5, age / AFFINITY_HALF_LIFE_MS);
  if (factor > 0.999) return profile;

  const decayMap = (map: AffinityMap): AffinityMap => {
    const out: AffinityMap = {};
    for (const [key, value] of Object.entries(map)) {
      const next = value * factor;
      if (Math.abs(next) >= 0.01) out[key] = next;
    }
    return out;
  };

  return {
    ...profile,
    likedSeries: decayMap(profile.likedSeries),
    likedGenres: decayMap(profile.likedGenres),
    likedTropes: decayMap(profile.likedTropes),
    watchedSeries: decayMap(profile.watchedSeries),
    completedSeries: decayMap(profile.completedSeries),
    skippedSeries: decayMap(profile.skippedSeries),
    languageAffinity: decayMap(profile.languageAffinity),
    completionAffinity: profile.completionAffinity * factor,
    engagementAffinity: profile.engagementAffinity * factor,
    updatedAt: now,
  };
}

export function isColdStart(profile: UserTasteProfile): boolean {
  return profile.interactionCount < 3 && profile.recentHistory.length < 3;
}

export function averageAffinity(map: AffinityMap, keys: string[]): number {
  if (keys.length === 0) return 0;
  let sum = 0;
  for (const key of keys) sum += map[key] ?? 0;
  return sum / keys.length;
}
