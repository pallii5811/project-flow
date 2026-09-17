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

/**
 * One resume point per series (VIR-2): following a shared link into another
 * series never wipes the place the viewer had in their own.
 */
export type ResumeStore = {
  /** The most recent resume point, whatever the series. */
  load(): Promise<ResumeSnapshot | null>;
  /** The resume point of one series. */
  loadForSeries(seriesId: string): Promise<ResumeSnapshot | null>;
  /** Every series, most recent first. */
  loadAll(): Promise<ResumeSnapshot[]>;
  /** Replaces the resume point of the snapshot's series only. */
  save(snapshot: ResumeSnapshot): Promise<void>;
  clear(): Promise<void>;
};

/** Series remembered at most; the least recently watched is forgotten first. */
export const RESUME_SERIES_CAP = 20;

/** Most recent first, one entry per series, at most `cap` entries. */
export function upsertResumeEntry(
  entries: readonly ResumeSnapshot[],
  snapshot: ResumeSnapshot,
  cap = RESUME_SERIES_CAP,
): ResumeSnapshot[] {
  const others = entries.filter((entry) => entry.seriesId !== snapshot.seriesId);
  return sortResumeEntries([snapshot, ...others]).slice(0, Math.max(0, cap));
}

export function sortResumeEntries(entries: readonly ResumeSnapshot[]): ResumeSnapshot[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createMemoryResumeStore(
  initial: ResumeSnapshot | null = null,
): ResumeStore {
  let entries: ResumeSnapshot[] = initial ? [initial] : [];
  return {
    async load() {
      return entries[0] ?? null;
    },
    async loadForSeries(seriesId) {
      return entries.find((entry) => entry.seriesId === seriesId) ?? null;
    },
    async loadAll() {
      return [...entries];
    },
    async save(snapshot) {
      entries = upsertResumeEntry(entries, snapshot);
    },
    async clear() {
      entries = [];
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

/** Below this position an episode restarts from the beginning. */
export const RESUME_MIN_POSITION_MS = 2000;

export function isResumable(snapshot: ResumeSnapshot | null): snapshot is ResumeSnapshot {
  if (!snapshot || snapshot.completed) return false;
  // Ignore near-start noise and near-end completions.
  if (snapshot.positionMs < RESUME_MIN_POSITION_MS) return false;
  return !isNearEnd(snapshot);
}

/** Watched to the end, or so close that resuming would only show the credits. */
export function isNearEnd(snapshot: ResumeSnapshot): boolean {
  if (snapshot.completed) return true;
  if (snapshot.durationMs <= 0) return false;
  const remaining = snapshot.durationMs - snapshot.positionMs;
  // Absolute floor matters for short episodes (10s stand-ins / vertical drama).
  if (remaining < 1500) return true;
  return snapshot.positionMs / snapshot.durationMs > 0.92;
}

/**
 * Whether `next` should replace `previous` as the resume point. A barely
 * started episode of the same series never replaces an episode the viewer
 * finished: the finished one already sends a returning viewer to the next
 * episode (VIR-1). Leaving an auto-continued episode within its first seconds
 * therefore still reopens on it, while a glimpse of any other episode stays
 * what it was before: not a place to return to.
 */
export function keepsFinishedEpisode(
  previous: ResumeSnapshot | null,
  next: ResumeSnapshot,
): boolean {
  if (!previous || next.completed) return false;
  if (previous.seriesId !== next.seriesId || previous.contentId === next.contentId) return false;
  return isNearEnd(previous) && next.positionMs < RESUME_MIN_POSITION_MS;
}

export type ResumeLanding = {
  contentId: string;
  /** Where Continue seeks; 0 means the episode starts from the beginning. */
  positionMs: number;
  /**
   * resume: the saved episode at its saved position;
   * next_episode: the saved one was finished, so the next one of the series.
   */
  reason: "resume" | "next_episode";
};

/**
 * Where a returning viewer lands (VIR-1). A finished episode sends them to the
 * next one of that series instead of the top of the feed; a series watched to
 * its last episode has nothing to continue, and a barely started episode is
 * not a place to return to (the viewer most often swiped it away).
 */
export function resumeLanding(
  snapshot: ResumeSnapshot | null,
  nextEpisodeId: (contentId: string) => string | null,
): ResumeLanding | null {
  if (!snapshot) return null;
  if (isNearEnd(snapshot)) {
    const next = nextEpisodeId(snapshot.contentId);
    return next ? { contentId: next, positionMs: 0, reason: "next_episode" } : null;
  }
  if (!isResumable(snapshot)) return null;
  return { contentId: snapshot.contentId, positionMs: snapshot.positionMs, reason: "resume" };
}
