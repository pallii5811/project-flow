import { describe, expect, it } from "vitest";

import {
  RETENTION_STORAGE_KEY,
  createLocalStorageRetentionStore,
  createMemoryRetentionStore,
} from "./localStorageRetentionStore";
import {
  FOLLOW_CAP,
  LIKE_CAP,
  RETENTION_STATE_VERSION,
  WATCHED_CAP,
  emptyRetentionState,
  followedSeriesIds,
  isFollowing,
  isLiked,
  likedContentIds,
  markSeriesSeen,
  markWatched,
  newEpisodesLine,
  newSinceLastVisit,
  parseRetentionState,
  toggleFollow,
  toggleLike,
  watchedContentIds,
  type RetentionState,
} from "./retentionState";

const NOW = 1_790_000_000_000;

const followed: RetentionState = {
  version: RETENTION_STATE_VERSION,
  follows: [
    {
      seriesId: "series_signal",
      seriesSlug: "signal-night",
      seenEpisodeCount: 3,
      followedAt: NOW,
      updatedAt: NOW,
    },
  ],
  likes: [],
  watched: [],
};

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe("toggleFollow", () => {
  it("records what the series has now, so the count starts at the promise", () => {
    const state = toggleFollow(
      emptyRetentionState(),
      { seriesId: "series_signal", seriesSlug: "signal-night", episodeCount: 5 },
      NOW,
    );
    expect(state.follows).toEqual([
      {
        seriesId: "series_signal",
        seriesSlug: "signal-night",
        seenEpisodeCount: 5,
        followedAt: NOW,
        updatedAt: NOW,
      },
    ]);
    expect(isFollowing(state, "series_signal")).toBe(true);
    expect([...followedSeriesIds(state)]).toEqual(["series_signal"]);
  });

  it("keeps an unknown episode count null, never zero", () => {
    const state = toggleFollow(
      emptyRetentionState(),
      { seriesId: "series_signal", seriesSlug: "signal-night", episodeCount: null },
      NOW,
    );
    expect(state.follows[0]?.seenEpisodeCount).toBeNull();
    // Zero would announce the whole series as new on the next visit.
    expect(
      newSinceLastVisit(state, new Map([["series_signal", 5]])),
    ).toEqual([]);
  });

  it("unfollows a series already followed", () => {
    const state = toggleFollow(
      followed,
      { seriesId: "series_signal", seriesSlug: "signal-night", episodeCount: 5 },
      NOW + 1,
    );
    expect(state.follows).toEqual([]);
  });

  it("keeps at most FOLLOW_CAP series, dropping the oldest", () => {
    let state = emptyRetentionState();
    for (let i = 0; i < FOLLOW_CAP + 5; i += 1) {
      state = toggleFollow(
        state,
        { seriesId: `s${i}`, seriesSlug: `s-${i}`, episodeCount: 1 },
        NOW + i,
      );
    }
    expect(state.follows).toHaveLength(FOLLOW_CAP);
    expect(state.follows[0]?.seriesId).toBe(`s${FOLLOW_CAP + 4}`);
    expect(isFollowing(state, "s0")).toBe(false);
  });
});

describe("toggleLike", () => {
  it("adds and removes one episode", () => {
    const liked = toggleLike(
      emptyRetentionState(),
      { contentId: "item_signal_2", seriesId: "series_signal" },
      NOW,
    );
    expect(isLiked(liked, "item_signal_2")).toBe(true);
    expect([...likedContentIds(liked)]).toEqual(["item_signal_2"]);
    const unliked = toggleLike(
      liked,
      { contentId: "item_signal_2", seriesId: "series_signal" },
      NOW + 1,
    );
    expect(unliked.likes).toEqual([]);
  });

  it("keeps at most LIKE_CAP episodes", () => {
    let state = emptyRetentionState();
    for (let i = 0; i < LIKE_CAP + 3; i += 1) {
      state = toggleLike(state, { contentId: `c${i}`, seriesId: "s" }, NOW + i);
    }
    expect(state.likes).toHaveLength(LIKE_CAP);
    expect(isLiked(state, "c0")).toBe(false);
  });
});

describe("newSinceLastVisit", () => {
  it("counts only what appeared after the viewer was told", () => {
    expect(newSinceLastVisit(followed, new Map([["series_signal", 5]]))).toEqual([
      {
        seriesId: "series_signal",
        seriesSlug: "signal-night",
        newCount: 2,
        firstNewEpisodeNumber: 4,
        episodeCount: 5,
      },
    ]);
  });

  it("says nothing when nothing is new", () => {
    expect(newSinceLastVisit(followed, new Map([["series_signal", 3]]))).toEqual([]);
  });

  it("skips a series the catalog does not carry, instead of counting backwards", () => {
    // A closed licence window, or a build without that title: an absence.
    expect(newSinceLastVisit(followed, new Map())).toEqual([]);
    expect(newSinceLastVisit(followed, new Map([["series_signal", 1]]))).toEqual([]);
  });

  it("puts the series with the most new episodes first", () => {
    const state: RetentionState = {
      ...followed,
      follows: [
        ...followed.follows,
        {
          seriesId: "series_other",
          seriesSlug: "other",
          seenEpisodeCount: 1,
          followedAt: NOW,
          updatedAt: NOW,
        },
      ],
    };
    const news = newSinceLastVisit(
      state,
      new Map([
        ["series_signal", 5],
        ["series_other", 9],
      ]),
    );
    expect(news.map((entry) => entry.seriesId)).toEqual([
      "series_other",
      "series_signal",
    ]);
  });
});

describe("markSeriesSeen", () => {
  it("moves the mark to what the viewer has now been told", () => {
    const after = markSeriesSeen(followed, "series_signal", 5, NOW + 10);
    expect(after.follows[0]?.seenEpisodeCount).toBe(5);
    expect(after.follows[0]?.updatedAt).toBe(NOW + 10);
    expect(newSinceLastVisit(after, new Map([["series_signal", 5]]))).toEqual([]);
  });

  it("fills in a follow made without a known count", () => {
    const unknown = toggleFollow(
      emptyRetentionState(),
      { seriesId: "series_signal", seriesSlug: "signal-night", episodeCount: null },
      NOW,
    );
    const after = markSeriesSeen(unknown, "series_signal", 5, NOW + 1);
    expect(after.follows[0]?.seenEpisodeCount).toBe(5);
  });

  it("changes nothing when the count is unknown or already right", () => {
    expect(markSeriesSeen(followed, "series_signal", null, NOW + 10)).toBe(followed);
    expect(markSeriesSeen(followed, "series_signal", 3, NOW + 10)).toBe(followed);
    expect(markSeriesSeen(followed, "series_gone", 9, NOW + 10)).toBe(followed);
  });
});

describe("markWatched", () => {
  const episode = {
    contentId: "item_signal_1",
    seriesId: "series_signal",
    episodeNumber: 1,
  };

  it("records an episode watched to the end, once", () => {
    const once = markWatched(emptyRetentionState(), episode, NOW);
    expect(once.watched).toEqual([{ ...episode, at: NOW }]);
    expect([...watchedContentIds(once)]).toEqual(["item_signal_1"]);
    // Watching it again is not a new fact: the row and its time stay put.
    expect(markWatched(once, episode, NOW + 9_000)).toBe(once);
  });

  it("keeps at most WATCHED_CAP episodes, dropping the oldest", () => {
    let state = emptyRetentionState();
    for (let i = 0; i < WATCHED_CAP + 2; i += 1) {
      state = markWatched(
        state,
        { contentId: `c${i}`, seriesId: "s", episodeNumber: i + 1 },
        NOW + i,
      );
    }
    expect(state.watched).toHaveLength(WATCHED_CAP);
    expect(watchedContentIds(state).has("c0")).toBe(false);
  });

  it("drops a broken row without losing the rest", () => {
    const state = parseRetentionState({
      version: 1,
      follows: [],
      likes: [],
      watched: [
        { ...episode, at: NOW },
        { contentId: "item_signal_2", seriesId: "series_signal", episodeNumber: 2 },
      ],
    });
    expect(state.watched.map((entry) => entry.contentId)).toEqual(["item_signal_1"]);
  });
});

describe("newEpisodesLine", () => {
  it("counts in words the viewer would use", () => {
    expect(newEpisodesLine(1)).toBe("1 new episode");
    expect(newEpisodesLine(4)).toBe("4 new episodes");
  });
});

describe("parseRetentionState", () => {
  it("drops one broken row instead of the whole document", () => {
    const state = parseRetentionState({
      version: 1,
      follows: [
        followed.follows[0],
        { seriesId: "series_broken" },
        { ...followed.follows[0], seriesId: "series_b", seenEpisodeCount: -2 },
      ],
      likes: [{ contentId: "c", seriesId: "s", likedAt: NOW }, null, 7],
    });
    expect(state.follows.map((entry) => entry.seriesId)).toEqual(["series_signal"]);
    expect(state.likes.map((entry) => entry.contentId)).toEqual(["c"]);
  });

  it("reads an unknown version as nothing, never as a guess", () => {
    expect(parseRetentionState({ version: 2, follows: followed.follows })).toEqual(
      emptyRetentionState(),
    );
    expect(parseRetentionState(null)).toEqual(emptyRetentionState());
    expect(parseRetentionState("{}")).toEqual(emptyRetentionState());
  });

  it("keeps the newest row when a series was written twice", () => {
    const state = parseRetentionState({
      version: 1,
      follows: [
        { ...followed.follows[0], seenEpisodeCount: 1, updatedAt: NOW },
        { ...followed.follows[0], seenEpisodeCount: 4, updatedAt: NOW + 500 },
      ],
      likes: [],
    });
    expect(state.follows).toHaveLength(1);
    expect(state.follows[0]?.seenEpisodeCount).toBe(4);
  });

  it("accepts a follow whose count was never known", () => {
    const state = parseRetentionState({
      version: 1,
      follows: [{ ...followed.follows[0], seenEpisodeCount: null }],
      likes: [],
    });
    expect(state.follows[0]?.seenEpisodeCount).toBeNull();
  });
});

describe("createLocalStorageRetentionStore", () => {
  it("writes one versioned document a future account system can upload", () => {
    const storage = fakeStorage();
    const store = createLocalStorageRetentionStore(storage);
    store.save(
      toggleFollow(
        store.load(),
        { seriesId: "series_signal", seriesSlug: "signal-night", episodeCount: 5 },
        NOW,
      ),
    );
    expect(JSON.parse(storage.data.get(RETENTION_STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      follows: [
        {
          seriesId: "series_signal",
          seriesSlug: "signal-night",
          seenEpisodeCount: 5,
          followedAt: NOW,
          updatedAt: NOW,
        },
      ],
      likes: [],
      watched: [],
    });
    expect(isFollowing(store.load(), "series_signal")).toBe(true);
  });

  it("keeps playing when storage is blocked, full or absent", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const store = createLocalStorageRetentionStore(blocked);
    expect(store.load()).toEqual(emptyRetentionState());
    expect(() => store.save(followed)).not.toThrow();
    expect(() => store.clear()).not.toThrow();
    expect(createLocalStorageRetentionStore(null).load()).toEqual(emptyRetentionState());
  });

  it("survives a value that is not JSON any more", () => {
    const store = createLocalStorageRetentionStore(
      fakeStorage({ [RETENTION_STORAGE_KEY]: "{not json" }),
    );
    expect(store.load()).toEqual(emptyRetentionState());
  });

  it("remembers within the page when there is no storage at all", () => {
    const store = createMemoryRetentionStore();
    store.save(followed);
    expect(isFollowing(store.load(), "series_signal")).toBe(true);
    store.clear();
    expect(store.load()).toEqual(emptyRetentionState());
  });
});
