import { describe, expect, it } from "vitest";

import { MOCK_CATALOG } from "./data/catalog";
import { parseCatalog, parseContentItem } from "./model/validate";
import { reducePlaybackState } from "./player/playbackState";
import {
  computeTimeToFirstPlay,
  createFirstPlayTiming,
} from "./session/timing";
import { createDeterministicFeedSource } from "./source/deterministicFeedSource";
import {
  getFeedWindow,
  getPrefetchIds,
  resolveContinuation,
} from "./state/feedLogic";

describe("catalog validation", () => {
  it("loads the mock catalog", () => {
    const catalog = parseCatalog(MOCK_CATALOG);
    expect(catalog.items.length).toBeGreaterThan(3);
    expect(catalog.series.length).toBe(3);
  });

  it("requires cinematic hooks on every item", () => {
    const catalog = parseCatalog(MOCK_CATALOG);
    for (const item of catalog.items) {
      expect(item.hook.trim().length).toBeGreaterThan(8);
      expect(item.hook.includes("E" + item.episodeNumber)).toBe(false);
    }
    expect(catalog.series.every((s) => s.totalEpisodes >= 3)).toBe(true);
  });

  it("rejects malformed content", () => {
    expect(() => parseContentItem({ id: "x" })).toThrow(/malformed|Invalid/);
  });
});

describe("feed presentation", () => {
  it("formats episode labels for consumers", async () => {
    const { formatEpisodeLabel } = await import("./ui/feedPresentation");
    expect(formatEpisodeLabel(2)).toBe("Episode 2");
    expect(formatEpisodeLabel(0)).toBeNull();
  });
});

describe("deterministic feed source", () => {
  it("returns stable editorial order", () => {
    const source = createDeterministicFeedSource(MOCK_CATALOG);
    const a = source.getOrderedItems().map((item) => item.id);
    const b = source.getOrderedItems().map((item) => item.id);
    expect(a).toEqual(b);
    expect(a[0]).toBe("item_ember_1");
  });

  it("resolves next episode within a series", () => {
    const source = createDeterministicFeedSource(MOCK_CATALOG);
    const items = source.getOrderedItems();
    const first = items[0];
    expect(first).toBeDefined();
    if (!first) return;
    const next = source.getNextEpisode(first);
    expect(next?.id).toBe("item_ember_2");
  });
});

describe("feed window / prefetch", () => {
  it("exposes previous/current/next", () => {
    const items = createDeterministicFeedSource(MOCK_CATALOG).getOrderedItems();
    const window = getFeedWindow(items, 1);
    expect(window.previous?.id).toBe("item_ember_1");
    expect(window.current.id).toBe("item_ember_2");
    expect(window.next?.id).toBe("item_ember_3");
  });

  it("prefetches only adjacent ids", () => {
    const items = createDeterministicFeedSource(MOCK_CATALOG).getOrderedItems();
    const ids = getPrefetchIds(items, 0);
    expect(ids.size).toBe(2);
    expect(ids.has("item_ember_1")).toBe(true);
    expect(ids.has("item_ember_2")).toBe(true);
  });
});

describe("continuation", () => {
  it("continues to the next episode when available", () => {
    const source = createDeterministicFeedSource(MOCK_CATALOG);
    const items = source.getOrderedItems();
    const result = resolveContinuation(source, items, 0);
    expect(result.continuedEpisode).toBe(true);
    expect(items[result.nextIndex]?.id).toBe("item_ember_2");
  });

  it("does not autoplay unrelated series at end of series", () => {
    const source = createDeterministicFeedSource(MOCK_CATALOG);
    const items = source.getOrderedItems();
    const lastEmber = items.findIndex((item) => item.id === "item_ember_3");
    const result = resolveContinuation(source, items, lastEmber);
    expect(result.continuedEpisode).toBe(false);
    expect(result.nextIndex).toBe(lastEmber);
  });
});

describe("playback state machine", () => {
  it("moves loading → ready → playing → completed", () => {
    let state = reducePlaybackState("idle", { type: "LOAD" });
    expect(state).toBe("loading");
    state = reducePlaybackState(state, { type: "READY" });
    expect(state).toBe("ready");
    state = reducePlaybackState(state, { type: "PLAY" });
    expect(state).toBe("playing");
    state = reducePlaybackState(state, { type: "COMPLETE" });
    expect(state).toBe("completed");
  });

  it("enters error on ERROR", () => {
    expect(reducePlaybackState("playing", { type: "ERROR", message: "x" })).toBe(
      "error",
    );
  });
});

describe("time to first play", () => {
  it("computes ttfp from open to actual playback", () => {
    const timing = createFirstPlayTiming(1000);
    timing.firstPlayAttemptTimestamp = 1100;
    timing.videoReadyTimestamp = 1300;
    timing.actualPlaybackTimestamp = 1450;
    expect(computeTimeToFirstPlay(timing)).toBe(450);
  });

  it("returns null until playback starts", () => {
    expect(computeTimeToFirstPlay(createFirstPlayTiming())).toBeNull();
  });
});
