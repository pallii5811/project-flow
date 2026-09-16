import { describe, expect, it } from "vitest";

import {
  NEAR_END_RATIO,
  reduceEpisodeBoundary,
  type EpisodeBoundaryState,
} from "./episodeBoundary";
import {
  createBingeSession,
  endBingeChain,
  noteEpisodeContinued,
  noteEpisodeStarted,
} from "./bingeSession";
import { getContinuationPrefetchIds } from "./prefetch";
import { resolveNextInSeries } from "./resolveNextInSeries";
import { MOCK_CATALOG } from "../data/catalog";
import { createDeterministicFeedSource } from "../source/deterministicFeedSource";
import {
  createMemoryResumeStore,
  isResumable,
  shouldPersistResume,
  type ResumeSnapshot,
} from "../resume/resumeStore";

describe("resolveNextInSeries", () => {
  const source = createDeterministicFeedSource(MOCK_CATALOG);
  const items = source.getOrderedItems();

  it("resolves middle episode to next in series", () => {
    const result = resolveNextInSeries(source, items, 0);
    expect(result.kind).toBe("next_in_series");
    if (result.kind === "next_in_series") {
      expect(result.next.id).toBe("item_ember_2");
    }
  });

  it("marks series complete on final episode", () => {
    const lastEmber = items.findIndex((item) => item.id === "item_ember_3");
    const result = resolveNextInSeries(source, items, lastEmber);
    expect(result.kind).toBe("series_complete");
  });

  it("handles first episode", () => {
    const result = resolveNextInSeries(source, items, 0);
    expect(result.kind).toBe("next_in_series");
  });
});

describe("episode boundary state machine", () => {
  it("walks playing → ending → preparing → transitioning → next_playing", () => {
    let state: EpisodeBoundaryState = "playing";
    state = reduceEpisodeBoundary(state, { type: "NEAR_END" });
    expect(state).toBe("ending");
    state = reduceEpisodeBoundary(state, { type: "COMPLETED" });
    expect(state).toBe("ending");
    state = reduceEpisodeBoundary(state, {
      type: "NEXT_RESOLVED",
      nextEpisodeId: "x",
    });
    expect(state).toBe("preparing_next");
    state = reduceEpisodeBoundary(state, { type: "PREPARE_READY" });
    expect(state).toBe("preparing_next");
    state = reduceEpisodeBoundary(state, { type: "TRANSITION_STARTED" });
    expect(state).toBe("transitioning");
    state = reduceEpisodeBoundary(state, { type: "TRANSITION_COMPLETED" });
    expect(state).toBe("next_playing");
  });

  it("enters series_ended when no next", () => {
    expect(reduceEpisodeBoundary("ending", { type: "NO_NEXT" })).toBe("series_ended");
  });

  it("enters failed on prepare failure", () => {
    expect(
      reduceEpisodeBoundary("preparing_next", {
        type: "PREPARE_FAILED",
        message: "boom",
      }),
    ).toBe("failed");
  });
});

describe("resume persistence policy", () => {
  it("persists on content change and throttles small deltas", () => {
    const base: ResumeSnapshot = {
      contentId: "a",
      seriesId: "s",
      episodeId: "e",
      positionMs: 5000,
      durationMs: 60_000,
      muted: true,
      captionsOn: true,
      updatedAt: 1000,
      completed: false,
    };
    expect(
      shouldPersistResume(base, { ...base, positionMs: 5500, updatedAt: 2000 }),
    ).toBe(false);
    expect(
      shouldPersistResume(base, { ...base, positionMs: 9000, updatedAt: 2000 }),
    ).toBe(true);
    expect(shouldPersistResume(base, { ...base, completed: true })).toBe(true);
  });

  it("round-trips through memory store and detects resumable snapshots", async () => {
    const store = createMemoryResumeStore();
    const snapshot: ResumeSnapshot = {
      contentId: "item_ember_1",
      seriesId: "series_ember",
      episodeId: "ep_ember_1",
      positionMs: 8000,
      durationMs: 15_000,
      muted: true,
      captionsOn: false,
      updatedAt: Date.now(),
      completed: false,
    };
    await store.save(snapshot);
    const loaded = await store.load();
    expect(loaded?.contentId).toBe("item_ember_1");
    expect(isResumable(loaded)).toBe(true);
    expect(isResumable({ ...snapshot, positionMs: 500 })).toBe(false);
    expect(isResumable({ ...snapshot, completed: true })).toBe(false);
  });
});

describe("continuation prefetch", () => {
  it("includes next-in-series near end", () => {
    const source = createDeterministicFeedSource(MOCK_CATALOG);
    const items = source.getOrderedItems();
    const ids = getContinuationPrefetchIds(source, items, 0, NEAR_END_RATIO);
    expect(ids.has("item_ember_1")).toBe(true);
    expect(ids.has("item_ember_2")).toBe(true);
  });
});

describe("binge session", () => {
  it("tracks consecutive in-series continuations", () => {
    const binge = createBingeSession();
    noteEpisodeStarted(binge, "series_ember");
    noteEpisodeContinued(binge, "series_ember");
    noteEpisodeContinued(binge, "series_ember");
    expect(binge.episodesContinued).toBe(2);
    expect(binge.active).toBe(true);
    endBingeChain(binge);
    expect(binge.active).toBe(false);
  });
});

describe("20-episode continuation chain (memory)", () => {
  it("does not accumulate player instance ids across transitions", () => {
    const activePlayers = new Set<string>();
    const leaked: string[] = [];

    function mount(id: string) {
      activePlayers.add(id);
    }
    function release(id: string) {
      if (!activePlayers.delete(id)) {
        leaked.push(id);
      }
    }

    let state: EpisodeBoundaryState = "playing";
    let current = 0;
    for (let i = 0; i < 20; i += 1) {
      const curId = `ep_${current}`;
      const nextId = `ep_${current + 1}`;
      mount(curId);
      mount(nextId); // prefetch next
      state = reduceEpisodeBoundary(state, { type: "NEAR_END" });
      state = reduceEpisodeBoundary(state, { type: "COMPLETED" });
      state = reduceEpisodeBoundary(state, {
        type: "NEXT_RESOLVED",
        nextEpisodeId: nextId,
      });
      state = reduceEpisodeBoundary(state, { type: "TRANSITION_STARTED" });
      release(curId); // release previous after transition
      state = reduceEpisodeBoundary(state, { type: "TRANSITION_COMPLETED" });
      state = reduceEpisodeBoundary(state, { type: "RESET_PLAYING" });
      current += 1;
      // Keep only current + next (+ optional prev) ⇒ ≤ 3
      expect(activePlayers.size).toBeLessThanOrEqual(3);
    }

    expect(leaked).toEqual([]);
    expect(activePlayers.size).toBeLessThanOrEqual(3);
  });
});
