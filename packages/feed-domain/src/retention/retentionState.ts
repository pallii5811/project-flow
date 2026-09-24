/**
 * What a viewer keeps between visits: the series they follow, the episodes
 * they liked, and — the point of the whole file — how many episodes each
 * followed series had the last time we told them about it.
 *
 * There is no account and no server (docs/deploy.md: a static export on
 * Cloudflare Pages), so this lives on the device. Everything here is pure; the
 * device half is `localStorageRetentionStore.ts`.
 *
 * ## The shape on disk, and why it is this one
 *
 * ```json
 * {
 *   "version": 1,
 *   "follows": [
 *     {
 *       "seriesId": "series_signal",
 *       "seriesSlug": "signal-night",
 *       "seenEpisodeCount": 3,
 *       "followedAt": 1790000000000,
 *       "updatedAt": 1790000000000
 *     }
 *   ],
 *   "likes": [
 *     { "contentId": "item_signal_2", "seriesId": "series_signal", "likedAt": 1790000000000 }
 *   ],
 *   "watched": [
 *     {
 *       "contentId": "item_signal_1",
 *       "seriesId": "series_signal",
 *       "episodeNumber": 1,
 *       "at": 1790000000000
 *     }
 *   ]
 * }
 * ```
 *
 * It is written to be uploaded as it stands the day an account system exists:
 * one versioned document, ids that mean the same thing on the server as here,
 * absolute timestamps so two devices can be merged by `updatedAt` without
 * asking which clock was right, and no derived field that a catalog change
 * could contradict.
 *
 * ## What a real push notification would need (batch 6/F7)
 *
 * A Web Push sent by a Cloudflare Worker needs two things: who to tell, and
 * what is new for them. `follows` IS the second one — `seriesId` plus
 * `seenEpisodeCount` is exactly the comparison `newSinceLastVisit` makes here
 * against the published catalog, and a Worker would make the same one against
 * the same catalog file. The first one is a `PushSubscription`, which the
 * browser gives only after the viewer accepts the permission prompt; it would
 * sit next to `follows` at the top level of this document, as
 * `"push": { "endpoint": "…", "keys": { … } }`, and be posted together with
 * the follow list. Nothing here has to change shape for that to work, and
 * nothing here promises a notification, because none is sent today.
 */

export const RETENTION_STATE_VERSION = 1;

/**
 * Bounds, so a long-lived device cannot fill its storage quota and start
 * losing the resume points that share it. Oldest entries go first.
 */
export const FOLLOW_CAP = 200;
export const LIKE_CAP = 500;
export const WATCHED_CAP = 500;

export type FollowedSeries = {
  seriesId: string;
  /** The address of its page, so a notification can link to it with no catalog. */
  seriesSlug: string;
  /**
   * Episodes this series had the last time the viewer was TOLD about it —
   * when they followed it, or when a "new since you were here" line was shown.
   * Never the count at the last playback: the viewer must be told once, not
   * have the news cancelled by their own watching.
   *
   * `null` means the count was not known when the follow was made, which is
   * not the same as zero: nothing is announced for such a series until a visit
   * that knows the catalog records the real count (docs 2d, rule 3).
   */
  seenEpisodeCount: number | null;
  followedAt: number;
  updatedAt: number;
};

export type LikedEpisode = {
  contentId: string;
  seriesId: string;
  likedAt: number;
};

/**
 * An episode watched to the end. Only the end: a slide glimpsed for a second
 * is not a thing the viewer did, and a list that marks it would be the list
 * lying about them.
 */
export type WatchedEpisode = {
  contentId: string;
  seriesId: string;
  episodeNumber: number;
  at: number;
};

export type RetentionState = {
  version: typeof RETENTION_STATE_VERSION;
  follows: FollowedSeries[];
  likes: LikedEpisode[];
  watched: WatchedEpisode[];
};

export function emptyRetentionState(): RetentionState {
  return { version: RETENTION_STATE_VERSION, follows: [], likes: [], watched: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A whole count of episodes. Anything else is not a number we can subtract. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isFollowedSeries(value: unknown): value is FollowedSeries {
  if (!isRecord(value)) return false;
  return (
    typeof value.seriesId === "string" &&
    value.seriesId.length > 0 &&
    typeof value.seriesSlug === "string" &&
    value.seriesSlug.length > 0 &&
    (value.seenEpisodeCount === null || isCount(value.seenEpisodeCount)) &&
    isTime(value.followedAt) &&
    isTime(value.updatedAt)
  );
}

export function isLikedEpisode(value: unknown): value is LikedEpisode {
  if (!isRecord(value)) return false;
  return (
    typeof value.contentId === "string" &&
    value.contentId.length > 0 &&
    typeof value.seriesId === "string" &&
    value.seriesId.length > 0 &&
    isTime(value.likedAt)
  );
}

export function isWatchedEpisode(value: unknown): value is WatchedEpisode {
  if (!isRecord(value)) return false;
  return (
    typeof value.contentId === "string" &&
    value.contentId.length > 0 &&
    typeof value.seriesId === "string" &&
    value.seriesId.length > 0 &&
    isCount(value.episodeNumber) &&
    isTime(value.at)
  );
}

/** Newest first, so the caps drop what the viewer touched longest ago. */
function byNewest<T>(entries: T[], at: (entry: T) => number): T[] {
  return [...entries].sort((a, b) => at(b) - at(a));
}

/**
 * Reads what is on the device. A row that does not parse is dropped, never
 * the whole document: one corrupted like must not unfollow every series. An
 * unknown version is read as nothing — a future writer is free to change the
 * shape, and this reader will not guess at it.
 */
export function parseRetentionState(raw: unknown): RetentionState {
  if (!isRecord(raw) || raw.version !== RETENTION_STATE_VERSION) {
    return emptyRetentionState();
  }
  const follows = Array.isArray(raw.follows) ? raw.follows.filter(isFollowedSeries) : [];
  const likes = Array.isArray(raw.likes) ? raw.likes.filter(isLikedEpisode) : [];
  const watched = Array.isArray(raw.watched) ? raw.watched.filter(isWatchedEpisode) : [];
  // One entry per series and per episode, whatever was written.
  const bySeries = new Map<string, FollowedSeries>();
  for (const entry of byNewest(follows, (row) => row.updatedAt)) {
    if (!bySeries.has(entry.seriesId)) bySeries.set(entry.seriesId, entry);
  }
  const byContent = new Map<string, LikedEpisode>();
  for (const entry of byNewest(likes, (row) => row.likedAt)) {
    if (!byContent.has(entry.contentId)) byContent.set(entry.contentId, entry);
  }
  const byWatched = new Map<string, WatchedEpisode>();
  for (const entry of byNewest(watched, (row) => row.at)) {
    if (!byWatched.has(entry.contentId)) byWatched.set(entry.contentId, entry);
  }
  return {
    version: RETENTION_STATE_VERSION,
    follows: [...bySeries.values()].slice(0, FOLLOW_CAP),
    likes: [...byContent.values()].slice(0, LIKE_CAP),
    watched: [...byWatched.values()].slice(0, WATCHED_CAP),
  };
}

export function isFollowing(state: RetentionState, seriesId: string): boolean {
  return state.follows.some((entry) => entry.seriesId === seriesId);
}

export function isLiked(state: RetentionState, contentId: string): boolean {
  return state.likes.some((entry) => entry.contentId === contentId);
}

export function followedSeriesIds(state: RetentionState): Set<string> {
  return new Set(state.follows.map((entry) => entry.seriesId));
}

export function likedContentIds(state: RetentionState): Set<string> {
  return new Set(state.likes.map((entry) => entry.contentId));
}

export function watchedContentIds(state: RetentionState): Set<string> {
  return new Set(state.watched.map((entry) => entry.contentId));
}

/**
 * Records an episode watched to the end. Idempotent: watching it again does
 * not move it, so the cap drops the episodes seen longest ago, not the ones
 * rewatched least.
 */
export function markWatched(
  state: RetentionState,
  episode: Omit<WatchedEpisode, "at">,
  now: number,
): RetentionState {
  if (state.watched.some((entry) => entry.contentId === episode.contentId)) return state;
  return {
    ...state,
    watched: byNewest([{ ...episode, at: now }, ...state.watched], (row) => row.at).slice(
      0,
      WATCHED_CAP,
    ),
  };
}

export type FollowTarget = {
  seriesId: string;
  seriesSlug: string;
  /**
   * Episodes published right now, or null when the catalog the viewer has
   * does not say. Null stays null: a follow recorded as "0 episodes seen"
   * would announce the whole series as new on the next visit (docs 2d).
   */
  episodeCount: number | null;
};

/**
 * Follows a series, or unfollows one already followed. Following records what
 * the series has now, so "new since you were here" starts counting from the
 * moment of the promise, not from episode 1.
 */
export function toggleFollow(
  state: RetentionState,
  target: FollowTarget,
  now: number,
): RetentionState {
  if (isFollowing(state, target.seriesId)) {
    return {
      ...state,
      follows: state.follows.filter((entry) => entry.seriesId !== target.seriesId),
    };
  }
  const entry: FollowedSeries = {
    seriesId: target.seriesId,
    seriesSlug: target.seriesSlug,
    // Unknown count stays unknown: nothing is announced for this series until
    // a visit that knows the catalog records it (markSeriesSeen).
    seenEpisodeCount: target.episodeCount,
    followedAt: now,
    updatedAt: now,
  };
  return {
    ...state,
    follows: byNewest([entry, ...state.follows], (row) => row.updatedAt).slice(
      0,
      FOLLOW_CAP,
    ),
  };
}

export function toggleLike(
  state: RetentionState,
  target: { contentId: string; seriesId: string },
  now: number,
): RetentionState {
  if (isLiked(state, target.contentId)) {
    return {
      ...state,
      likes: state.likes.filter((entry) => entry.contentId !== target.contentId),
    };
  }
  const entry: LikedEpisode = {
    contentId: target.contentId,
    seriesId: target.seriesId,
    likedAt: now,
  };
  return {
    ...state,
    likes: byNewest([entry, ...state.likes], (row) => row.likedAt).slice(0, LIKE_CAP),
  };
}

/**
 * Records that the viewer has now been told this series has `episodeCount`
 * episodes. Called when the news is shown, and when a follow is made on a
 * page that knows the count.
 */
export function markSeriesSeen(
  state: RetentionState,
  seriesId: string,
  episodeCount: number | null,
  now: number,
): RetentionState {
  if (episodeCount === null) return state;
  let changed = false;
  const follows = state.follows.map((entry) => {
    if (entry.seriesId !== seriesId || entry.seenEpisodeCount === episodeCount) {
      return entry;
    }
    changed = true;
    return { ...entry, seenEpisodeCount: episodeCount, updatedAt: now };
  });
  return changed ? { ...state, follows } : state;
}

export type NewEpisodes = {
  seriesId: string;
  seriesSlug: string;
  /** How many episodes appeared since the viewer was last told. */
  newCount: number;
  /** Where to send them: the first episode they have not been told about. */
  firstNewEpisodeNumber: number;
  /** What the series has now, i.e. what to record once they are told. */
  episodeCount: number;
};

/**
 * What is new for this viewer, most new first.
 *
 * `episodeCounts` is what the catalog says today. A series missing from it is
 * SKIPPED, not reported as zero: a title out of its licence window, or one
 * this build does not carry, is an absence — announcing "0 new" or, worse,
 * counting backwards, would be inventing a fact from a missing one (docs 2d,
 * rule 3).
 */
export function newSinceLastVisit(
  state: RetentionState,
  episodeCounts: ReadonlyMap<string, number>,
): NewEpisodes[] {
  const news: NewEpisodes[] = [];
  for (const entry of state.follows) {
    const episodeCount = episodeCounts.get(entry.seriesId);
    if (episodeCount === undefined) continue;
    // Never told what this series had: there is no "since" to count from.
    if (entry.seenEpisodeCount === null) continue;
    if (episodeCount <= entry.seenEpisodeCount) continue;
    news.push({
      seriesId: entry.seriesId,
      seriesSlug: entry.seriesSlug,
      newCount: episodeCount - entry.seenEpisodeCount,
      firstNewEpisodeNumber: entry.seenEpisodeCount + 1,
      episodeCount,
    });
  }
  return news.sort((a, b) => b.newCount - a.newCount);
}

/** "2 new episodes", "1 new episode": one line, built from the numbers. */
export function newEpisodesLine(newCount: number): string {
  return newCount === 1 ? "1 new episode" : `${newCount} new episodes`;
}
