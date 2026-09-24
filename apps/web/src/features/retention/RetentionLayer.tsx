"use client";

/**
 * Everything the feed does to be come back to — follow, like, what was
 * watched, "new since you were here" — in ONE chunk the feed loads after its
 * first frame (FeedApp, ensureRetention), never before it.
 *
 * Measured on 2026-09-24, interleaved cold opens on the throttled phone
 * profile: with this code in the feed's first-load JavaScript the first frame
 * came 108 ms later (8,212 → 8,320 ms median, 9.7 kB more script before the
 * frame). None of it is needed to show a picture: the rail can draw its
 * follow state a moment later, and the news waits for the full catalog, which
 * itself arrives after first play. So it lives here, where the first frame
 * never pays for it (docs/decisions.md, batch 8).
 */
import {
  createLocalStorageRetentionStore,
  markSeriesSeen,
  markWatched,
  newEpisodesLine,
  newSinceLastVisit,
  toggleFollow,
  toggleLike,
  type ContentItem,
  type FollowTarget,
  type NewEpisodes,
  type RetentionState,
} from "@project-flow/feed-domain";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { NewEpisodesStrip } from "@/features/feed/NewEpisodesStrip";

/** The news strip leaves on its own, like the Up next label, if untouched. */
const NEW_EPISODES_VISIBLE_MS = 12_000;

/** The device's retention document, with every change written through. */
export type RetentionRuntime = {
  state(): RetentionState;
  toggleFollow(target: FollowTarget, now: number): RetentionState;
  toggleLike(target: { contentId: string; seriesId: string }, now: number): RetentionState;
  markWatched(
    episode: { contentId: string; seriesId: string; episodeNumber: number },
    now: number,
  ): RetentionState;
  markSeen(seriesId: string, episodeCount: number | null, now: number): RetentionState;
  /** Follows made before the catalog was known learn the count now. */
  fillUnknownCounts(counts: ReadonlyMap<string, number>, now: number): RetentionState;
};

export function createRetentionRuntime(): RetentionRuntime {
  const store = createLocalStorageRetentionStore();
  let state = store.load();
  const commit = (next: RetentionState): RetentionState => {
    // Identical state is never written.
    if (next !== state) {
      state = next;
      store.save(next);
    }
    return state;
  };
  return {
    state: () => state,
    toggleFollow: (target, now) => commit(toggleFollow(state, target, now)),
    toggleLike: (target, now) => commit(toggleLike(state, target, now)),
    markWatched: (episode, now) => commit(markWatched(state, episode, now)),
    markSeen: (seriesId, episodeCount, now) =>
      commit(markSeriesSeen(state, seriesId, episodeCount, now)),
    fillUnknownCounts: (counts, now) => {
      let next = state;
      for (const entry of state.follows) {
        if (entry.seenEpisodeCount !== null) continue;
        // Nothing was ever announced for such a series (newSinceLastVisit
        // skips it), so nothing is swallowed; without this it would stay
        // unknown for good and the follow would never deliver anything.
        next = markSeriesSeen(next, entry.seriesId, counts.get(entry.seriesId) ?? null, now);
      }
      return commit(next);
    },
  };
}

/**
 * What the rail needs to draw: which series are followed, which episodes
 * liked. Never mutated: every change builds new sets, so React sees it.
 */
export type RetentionView = { following: Set<string>; liked: Set<string> };

export function viewOf(state: RetentionState): RetentionView {
  return {
    following: new Set(state.follows.map((entry) => entry.seriesId)),
    liked: new Set(state.likes.map((entry) => entry.contentId)),
  };
}

/**
 * Records what the viewer MEANT by a tap on Like: a tap made before the
 * device's state was read must not undo a like stored on an earlier visit.
 */
export function applyLike(
  runtime: RetentionRuntime,
  target: { contentId: string; seriesId: string },
  liked: boolean,
  at: number,
): RetentionView {
  const state = runtime.state();
  if (state.likes.some((entry) => entry.contentId === target.contentId) === liked) {
    return viewOf(state);
  }
  return viewOf(runtime.toggleLike(target, at));
}

/**
 * The same for Follow. Following records what the series has NOW, so "new
 * since you were here" counts from the promise, not from episode 1; before
 * the whole catalog is in that count is unknown and stays unknown (never 2),
 * and the layer fills it in when the catalog arrives.
 */
export function applyFollow(
  runtime: RetentionRuntime,
  target: { seriesId: string; seriesSlug: string | null },
  following: boolean,
  catalog: { ordered: readonly ContentItem[]; complete: boolean },
  at: number,
): RetentionView {
  const state = runtime.state();
  if (
    !target.seriesSlug ||
    state.follows.some((entry) => entry.seriesId === target.seriesId) === following
  ) {
    return viewOf(state);
  }
  return viewOf(
    runtime.toggleFollow(
      {
        seriesId: target.seriesId,
        seriesSlug: target.seriesSlug,
        episodeCount:
          publishedCountsOf(catalog.ordered, catalog.complete)?.get(target.seriesId) ?? null,
      },
      at,
    ),
  );
}

/**
 * How many episodes of each series really play, in the catalog the feed has.
 * That, not the series' declared `totalEpisodes`, is the number a follow
 * remembers and the number news is counted against: the two are the same for
 * a finished series and differ while one is still being published, and only
 * this one can send the viewer to an episode that exists. Null until the whole
 * catalog is in — the two episodes a page carries would count 2.
 */
export function publishedCountsOf(
  ordered: readonly ContentItem[],
  complete: boolean,
): Map<string, number> | null {
  if (!complete) return null;
  const counts = new Map<string, number>();
  for (const item of ordered) counts.set(item.seriesId, (counts.get(item.seriesId) ?? 0) + 1);
  return counts;
}

type RetentionLayerProps = {
  runtime: RetentionRuntime;
  /** Every playable episode the feed knows, and whether that is the whole catalog. */
  ordered: readonly ContentItem[];
  complete: boolean;
  /** The episode on screen: moving to another one is a choice, and the line goes. */
  currentId: string | null;
  /**
   * Something the viewer asked for owns the strip slot: a resume offer, the
   * end of a series, the Tune sheet, an error, the tap-to-play gate.
   */
  blocked: boolean;
  /** Every change the layer writes, as the rail draws it. */
  onViewChange: (view: RetentionView) => void;
  onOpenEpisode: (item: ContentItem) => void;
  /** The strip covers the title block: FeedApp dims it, as for Continue. */
  onVisibleChange: (visible: boolean) => void;
  track: (name: "new_episodes_shown" | "new_episodes_open", properties: Record<string, string | number | null>) => void;
};

/**
 * "New since you were here": what appeared for a followed series since the
 * viewer was last told, said once, one tap from the first episode they have
 * not seen. It waits for the WHOLE catalog, because a wrong count here is a
 * broken promise, not a cosmetic slip.
 */
export function RetentionLayer({
  runtime,
  ordered,
  complete,
  currentId,
  blocked,
  onViewChange,
  onOpenEpisode,
  onVisibleChange,
  track,
}: RetentionLayerProps): ReactElement | null {
  const counts = useMemo(() => publishedCountsOf(ordered, complete), [ordered, complete]);
  const [news, setNews] = useState<NewEpisodes | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const checked = useRef(false);
  const toldFor = useRef<string | null>(null);
  /** The episode the line first appeared over. */
  const shownOver = useRef<string | null>(null);

  // Once per visit, from the document as it was before anything here wrote.
  useEffect(() => {
    if (checked.current || !counts) return;
    checked.current = true;
    const found = newSinceLastVisit(runtime.state(), counts)[0] ?? null;
    if (found) setNews(found);
    onViewChange(viewOf(runtime.fillUnknownCounts(counts, Date.now())));
  }, [counts, onViewChange, runtime]);

  const target = useMemo(() => {
    if (!news) return null;
    // By position, not by number: the count is a number of episodes that
    // play, so the (seen + 1)-th of them is the one they were not told about.
    const ofSeries = ordered
      .filter((item) => item.seriesId === news.seriesId)
      .sort((a, b) => a.episodeNumber - b.episodeNumber);
    return ofSeries[news.firstNewEpisodeNumber - 1] ?? null;
  }, [news, ordered]);

  const visible = news !== null && target !== null && !dismissed && !blocked;

  useEffect(() => {
    onVisibleChange(visible);
  }, [onVisibleChange, visible]);

  // Told once: the moment the line is really on screen, this device has been
  // told what the series has, and the same news never comes back.
  useEffect(() => {
    if (!visible || !news || toldFor.current === news.seriesId) return;
    toldFor.current = news.seriesId;
    onViewChange(viewOf(runtime.markSeen(news.seriesId, news.episodeCount, Date.now())));
    track("new_episodes_shown", {
      series_id: news.seriesId,
      new_count: news.newCount,
      episode_count: news.episodeCount,
      first_new_episode: target?.episodeNumber ?? null,
    });
  }, [news, onViewChange, runtime, target, track, visible]);

  // It leaves on its own if untouched, counted afresh each time it is back on
  // screen (a sheet opened over it does not eat its time).
  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setDismissed(true), NEW_EPISODES_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  // A swipe to another episode is a choice: the line does not follow them.
  useEffect(() => {
    if (!visible) return;
    if (shownOver.current === null) {
      shownOver.current = currentId;
      return;
    }
    if (currentId !== shownOver.current) setDismissed(true);
  }, [currentId, visible]);

  if (!visible || !news || !target) return null;
  return (
    <NewEpisodesStrip
      seriesId={news.seriesId}
      seriesTitle={target.seriesTitle}
      countLine={newEpisodesLine(news.newCount)}
      episodeLabel={`Episode ${target.episodeNumber}`}
      onOpen={() => {
        setDismissed(true);
        track("new_episodes_open", {
          series_id: news.seriesId,
          content_id: target.id,
          new_count: news.newCount,
        });
        onOpenEpisode(target);
      }}
      onDismiss={() => setDismissed(true)}
    />
  );
}
