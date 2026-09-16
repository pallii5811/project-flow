export type ResumeSnapshot = {
  contentId: string;
  seriesId: string;
  episodeId: string;
  positionMs: number;
  durationMs: number;
  muted: boolean;
  captionsOn: boolean;
  updatedAt: number;
  completed: boolean;
};

export type ResumeStore = {
  load(): Promise<ResumeSnapshot | null>;
  save(snapshot: ResumeSnapshot): Promise<void>;
  clear(): Promise<void>;
};

export function createMemoryResumeStore(
  initial: ResumeSnapshot | null = null,
): ResumeStore {
  let value = initial;
  return {
    async load() {
      return value;
    },
    async save(snapshot) {
      value = snapshot;
    },
    async clear() {
      value = null;
    },
  };
}

/** Skip tiny/noisy writes; persist at least every `minIntervalMs` or on meaningful deltas. */
export function shouldPersistResume(
  previous: ResumeSnapshot | null,
  next: ResumeSnapshot,
  minIntervalMs = 5000,
  minDeltaMs = 3000,
): boolean {
  if (next.completed) return true;
  if (!previous || previous.contentId !== next.contentId) return true;
  if (next.updatedAt - previous.updatedAt >= minIntervalMs) return true;
  if (Math.abs(next.positionMs - previous.positionMs) >= minDeltaMs) return true;
  if (previous.muted !== next.muted || previous.captionsOn !== next.captionsOn) {
    return true;
  }
  return false;
}

export function isResumable(snapshot: ResumeSnapshot | null): snapshot is ResumeSnapshot {
  if (!snapshot || snapshot.completed) return false;
  // Ignore near-start noise and near-end completions.
  if (snapshot.positionMs < 2000) return false;
  if (snapshot.durationMs > 0) {
    const remaining = snapshot.durationMs - snapshot.positionMs;
    // Absolute floor matters for short episodes (10s stand-ins / vertical drama).
    if (remaining < 1500) return false;
    if (snapshot.positionMs / snapshot.durationMs > 0.92) return false;
  }
  return true;
}
