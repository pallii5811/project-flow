import { describe, expect, it } from "vitest";

import {
  LEGACY_RESUME_STORAGE_KEY,
  RESUME_STORAGE_KEY,
  createLocalStorageResumeStore,
  readResumeEntries,
} from "./localStorageResumeStore";
import {
  RESUME_SERIES_CAP,
  createMemoryResumeStore,
  isResumable,
  keepsFinishedEpisode,
  resumeLanding,
  upsertResumeEntry,
  type ResumeSnapshot,
} from "./resumeStore";

const base: ResumeSnapshot = {
  contentId: "item_signal_1",
  seriesId: "series_signal",
  episodeId: "ep_signal_1",
  positionMs: 4000,
  durationMs: 10_000,
  muted: true,
  captionsOn: false,
  updatedAt: 1,
  completed: false,
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

describe("isResumable", () => {
  it("accepts mid-episode progress", () => {
    expect(isResumable(base)).toBe(true);
  });

  it("rejects near-end on short episodes (absolute remaining)", () => {
    expect(isResumable({ ...base, positionMs: 8800 })).toBe(false);
  });

  it("rejects high completion ratio", () => {
    expect(
      isResumable({ ...base, positionMs: 14_000, durationMs: 15_000 }),
    ).toBe(false);
  });
});

describe("resumeLanding (VIR-1)", () => {
  const nextOf = (id: string) =>
    ({ item_signal_1: "item_signal_2", item_signal_7: "item_signal_8" })[id] ?? null;

  it("resumes a mid-episode snapshot at its position", () => {
    expect(resumeLanding(base, nextOf)).toEqual({
      contentId: "item_signal_1",
      positionMs: 4000,
      reason: "resume",
    });
  });

  it("sends a completed episode to the next one of the series, from the start", () => {
    expect(
      resumeLanding({ ...base, contentId: "item_signal_7", completed: true }, nextOf),
    ).toEqual({ contentId: "item_signal_8", positionMs: 0, reason: "next_episode" });
  });

  it("treats more than 92% watched as finished", () => {
    expect(
      resumeLanding({ ...base, positionMs: 55_500, durationMs: 60_000 }, nextOf),
    ).toEqual({ contentId: "item_signal_2", positionMs: 0, reason: "next_episode" });
  });

  it("treats less than 1.5 s left as finished", () => {
    expect(resumeLanding({ ...base, positionMs: 8_700 }, nextOf)?.reason).toBe("next_episode");
  });

  it("does not land on a barely started episode (a quick swipe away)", () => {
    expect(resumeLanding({ ...base, positionMs: 1_200 }, nextOf)).toBeNull();
    expect(resumeLanding({ ...base, positionMs: 274 }, nextOf)).toBeNull();
  });

  it("has nothing to continue after the last episode", () => {
    expect(
      resumeLanding({ ...base, contentId: "item_signal_5", completed: true }, nextOf),
    ).toBeNull();
    expect(resumeLanding(null, nextOf)).toBeNull();
  });
});

describe("keepsFinishedEpisode (VIR-1)", () => {
  const finished = { ...base, positionMs: 10_000, completed: true };
  const glimpse = { ...base, contentId: "item_signal_2", episodeId: "ep_signal_2", positionMs: 300 };

  it("an auto-continued episode left in its first seconds keeps the finished one", () => {
    expect(keepsFinishedEpisode(finished, glimpse)).toBe(true);
    const nearEnd = { ...base, positionMs: 9_700 };
    expect(keepsFinishedEpisode(nearEnd, glimpse)).toBe(true);
    // ...so the landing is the next episode, from its start.
    expect(
      resumeLanding(finished, (id) => (id === "item_signal_1" ? "item_signal_2" : null)),
    ).toEqual({ contentId: "item_signal_2", positionMs: 0, reason: "next_episode" });
  });

  it("real progress in the next episode replaces the finished one", () => {
    expect(keepsFinishedEpisode(finished, { ...glimpse, positionMs: 2_500 })).toBe(false);
  });

  it("a glimpse after an episode left midway replaces it, as before", () => {
    expect(keepsFinishedEpisode(base, glimpse)).toBe(false);
  });

  it("never holds across series, on the same episode, or without a previous point", () => {
    expect(keepsFinishedEpisode(finished, { ...glimpse, seriesId: "series_other" })).toBe(false);
    expect(keepsFinishedEpisode(finished, { ...finished, positionMs: 100, completed: false })).toBe(
      false,
    );
    expect(keepsFinishedEpisode(null, glimpse)).toBe(false);
  });
});

describe("resume per series (VIR-2)", () => {
  const seriesA = { ...base, seriesId: "series_a", contentId: "a_23", updatedAt: 10 };
  const seriesB = { ...base, seriesId: "series_b", contentId: "b_1", updatedAt: 20 };

  it("a save in another series keeps the first series' point", async () => {
    const store = createMemoryResumeStore();
    await store.save(seriesA);
    await store.save(seriesB);
    expect((await store.loadForSeries("series_a"))?.contentId).toBe("a_23");
    expect((await store.load())?.contentId).toBe("b_1");
  });

  it("replaces only the same series and keeps the most recent first", () => {
    const entries = upsertResumeEntry(
      [seriesB, seriesA],
      { ...seriesA, contentId: "a_24", updatedAt: 30 },
    );
    expect(entries.map((entry) => entry.contentId)).toEqual(["a_24", "b_1"]);
  });

  it("forgets the least recently watched series beyond the cap", () => {
    let entries: ResumeSnapshot[] = [];
    for (let i = 0; i < RESUME_SERIES_CAP + 5; i += 1) {
      entries = upsertResumeEntry(entries, { ...base, seriesId: `s_${i}`, updatedAt: i });
    }
    expect(entries).toHaveLength(RESUME_SERIES_CAP);
    expect(entries[0]?.seriesId).toBe(`s_${RESUME_SERIES_CAP + 4}`);
    expect(entries.some((entry) => entry.seriesId === "s_0")).toBe(false);
  });

  it("reads the old single snapshot and migrates it on the next save", async () => {
    const storage = fakeStorage({
      [LEGACY_RESUME_STORAGE_KEY]: JSON.stringify(seriesA),
    });
    const store = createLocalStorageResumeStore(storage);
    expect((await store.load())?.contentId).toBe("a_23");

    await store.save(seriesB);
    expect(storage.data.has(LEGACY_RESUME_STORAGE_KEY)).toBe(false);
    expect((await store.loadForSeries("series_a"))?.contentId).toBe("a_23");
    expect((await store.load())?.contentId).toBe("b_1");
  });

  it("drops invalid rows without losing the valid ones", () => {
    const raw = JSON.stringify({ version: 2, entries: [seriesA, { contentId: 3 }, "x"] });
    expect(readResumeEntries(raw, "{not json")).toEqual([seriesA]);
    expect(readResumeEntries("{not json", null)).toEqual([]);
  });

  it("writes the list under its own key", async () => {
    const storage = fakeStorage();
    await createLocalStorageResumeStore(storage).save(seriesA);
    const saved = JSON.parse(storage.data.get(RESUME_STORAGE_KEY) ?? "null") as {
      entries: ResumeSnapshot[];
    };
    expect(saved.entries).toEqual([seriesA]);
  });
});
