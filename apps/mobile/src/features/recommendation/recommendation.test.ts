import { describe, expect, it } from "vitest";

import type { AnalyticsClient, AnalyticsEventName } from "@project-flow/analytics";

import { MOCK_CATALOG } from "../feed/data/catalog";
import type { ContentItem } from "../feed/model/types";
import { createDeterministicFeedSource } from "../feed/source/deterministicFeedSource";
import { generateCandidates } from "./candidates/generateCandidates";
import { applyDiversity } from "./diversity/applyDiversity";
import { applyExploration, seededUnit } from "./exploration/applyExploration";
import { RANK_WEIGHTS } from "./model/weights";
import {
  applySignal,
  createEmptyProfile,
  decayProfile,
  isColdStart,
} from "./profile/tasteProfile";
import { createMemoryTasteStore } from "./profile/tasteStore";
import { rankCandidates, scoreCandidate } from "./ranking/rankCandidates";
import { createTestRecommendationService } from "./service/createRecommendationService";
import { materializeFeedItems } from "./service/materializeFeedItems";
import type { UserTasteProfile } from "./model/types";

function catalog(): ContentItem[] {
  return createDeterministicFeedSource(MOCK_CATALOG).getOrderedItems();
}

function makeAnalytics() {
  const events: { event: AnalyticsEventName; properties?: Record<string, unknown> }[] =
    [];
  const analytics: AnalyticsClient = {
    track(event, properties) {
      events.push({ event, properties });
    },
  };
  return { analytics, events };
}

function romanceItem(items: ContentItem[]): ContentItem {
  return items.find((i) => i.genres.includes("romance")) ?? items[0]!;
}

function horrorItem(items: ContentItem[]): ContentItem {
  return items.find((i) => i.genres.includes("horror")) ?? items[items.length - 1]!;
}

describe("recommendation profile", () => {
  it("creates an empty cold-start profile", () => {
    const profile = createEmptyProfile(1_000);
    expect(isColdStart(profile)).toBe(true);
    expect(profile.recentHistory).toHaveLength(0);
    expect(profile.likedGenres).toEqual({});
  });

  it("applies positive updates incrementally", () => {
    const item = romanceItem(catalog());
    let profile = createEmptyProfile(1_000);
    profile = applySignal(profile, {
      contentId: item.id,
      seriesId: item.seriesId,
      genres: item.genres,
      tropes: item.tropes,
      language: item.language,
      action: "complete",
      watchDurationMs: item.durationMs,
      completionPercentage: 100,
      now: 1_000,
    });
    expect(profile.likedGenres.romance ?? 0).toBeGreaterThan(0);
    expect(profile.completedSeries[item.seriesId] ?? 0).toBeGreaterThan(0);
    expect(profile.interactionCount).toBe(1);
  });

  it("applies negative skip updates", () => {
    const item = horrorItem(catalog());
    let profile = createEmptyProfile(1_000);
    profile = applySignal(profile, {
      contentId: item.id,
      seriesId: item.seriesId,
      genres: item.genres,
      tropes: item.tropes,
      language: item.language,
      action: "skip",
      watchDurationMs: 500,
      completionPercentage: 5,
      now: 1_000,
    });
    expect(profile.skippedSeries[item.seriesId] ?? 0).toBeGreaterThan(0);
    expect(profile.likedGenres.horror ?? 0).toBeLessThan(0);
    expect(profile.recentSkips).toHaveLength(1);
  });

  it("decays affinity over time", () => {
    let profile = createEmptyProfile(1_000);
    profile = {
      ...profile,
      likedGenres: { romance: 2 },
      updatedAt: 1_000,
    };
    const halfLife = 14 * 24 * 60 * 60 * 1000;
    const decayed = decayProfile(profile, 1_000 + halfLife);
    expect(decayed.likedGenres.romance ?? 0).toBeCloseTo(1, 1);
  });

  it("bounds recent history", () => {
    const item = romanceItem(catalog());
    let profile = createEmptyProfile(1_000);
    for (let i = 0; i < 120; i += 1) {
      profile = applySignal(profile, {
        contentId: `${item.id}_${i}`,
        seriesId: item.seriesId,
        genres: item.genres,
        tropes: item.tropes,
        language: item.language,
        action: "view_start",
        watchDurationMs: 0,
        completionPercentage: 0,
        now: 1_000 + i,
      });
    }
    expect(profile.recentHistory.length).toBeLessThanOrEqual(80);
  });
});

describe("candidates", () => {
  it("generates candidates with source attribution", () => {
    const items = catalog();
    const profile = createEmptyProfile();
    const candidates = generateCandidates(items, profile, {
      language: "en",
      excludeContentIds: new Set(),
      activeSeriesId: null,
      continuationItemId: null,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.source.length > 0)).toBe(true);
  });

  it("filters unavailable content", () => {
    const items = catalog().map((item, i) =>
      i === 0 ? { ...item, videoUrl: "" } : item,
    );
    const candidates = generateCandidates(items, createEmptyProfile(), {
      language: "en",
      excludeContentIds: new Set(),
      activeSeriesId: null,
      continuationItemId: null,
    });
    expect(candidates.some((c) => c.contentId === items[0]!.id)).toBe(false);
  });

  it("merges multi-source candidates without duplication", () => {
    const items = catalog();
    const candidates = generateCandidates(items, createEmptyProfile(), {
      language: "en",
      excludeContentIds: new Set(),
      activeSeriesId: null,
      continuationItemId: null,
    });
    const ids = candidates.map((c) => c.contentId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ranking", () => {
  it("is deterministic for identical inputs", () => {
    const items = catalog();
    const byId = new Map(items.map((i) => [i.id, i]));
    const profile = createEmptyProfile(1_000);
    const candidates = generateCandidates(items, profile, {
      language: "en",
      excludeContentIds: new Set(),
      activeSeriesId: null,
      continuationItemId: null,
    });
    const a = rankCandidates(candidates, byId, profile, "en", 1_000);
    const b = rankCandidates(candidates, byId, profile, "en", 1_000);
    expect(a.map((c) => c.contentId)).toEqual(b.map((c) => c.contentId));
  });

  it("increases score for positive affinity", () => {
    const items = catalog();
    const romance = romanceItem(items);
    const cold = createEmptyProfile(1_000);
    let warm = createEmptyProfile(1_000);
    for (let i = 0; i < 5; i += 1) {
      warm = applySignal(warm, {
        contentId: romance.id,
        seriesId: romance.seriesId,
        genres: romance.genres,
        tropes: romance.tropes,
        language: romance.language,
        action: "complete",
        watchDurationMs: romance.durationMs,
        completionPercentage: 100,
        now: 1_000 + i,
      });
    }
    const coldScore = scoreCandidate(romance, cold, "en", 2_000);
    const warmScore = scoreCandidate(romance, warm, "en", 2_000);
    expect(warmScore).toBeGreaterThan(coldScore);
  });

  it("decreases score after negative skips", () => {
    const items = catalog();
    const horror = horrorItem(items);
    let profile = createEmptyProfile(1_000);
    for (let i = 0; i < 5; i += 1) {
      profile = applySignal(profile, {
        contentId: horror.id,
        seriesId: horror.seriesId,
        genres: horror.genres,
        tropes: horror.tropes,
        language: horror.language,
        action: "skip",
        watchDurationMs: 200,
        completionPercentage: 5,
        now: 1_000 + i,
      });
    }
    const cold = createEmptyProfile(1_000);
    expect(scoreCandidate(horror, profile, "en", 2_000)).toBeLessThan(
      scoreCandidate(horror, cold, "en", 2_000),
    );
  });

  it("keeps continuation at top", () => {
    const items = catalog();
    const byId = new Map(items.map((i) => [i.id, i]));
    const current = items[0]!;
    const next = items.find(
      (i) => i.seriesId === current.seriesId && i.episodeNumber === 2,
    )!;
    const candidates = generateCandidates(items, createEmptyProfile(), {
      language: "en",
      excludeContentIds: new Set(),
      activeSeriesId: current.seriesId,
      continuationItemId: next.id,
    });
    const ranked = rankCandidates(candidates, byId, createEmptyProfile(), "en", 1_000);
    expect(ranked[0]?.contentId).toBe(next.id);
    expect(ranked[0]?.source).toBe("continuation");
  });
});

describe("diversity + exploration", () => {
  it("prevents consecutive same-series when enabled", () => {
    const items = catalog();
    const byId = new Map(items.map((i) => [i.id, i]));
    const sameSeries = items
      .filter((i) => i.seriesId === items[0]!.seriesId)
      .map((i) => ({
        contentId: i.id,
        seriesId: i.seriesId,
        source: "editorial" as const,
        reasons: ["editorial" as const],
        score: 1,
      }));
    const diversified = applyDiversity(sameSeries, byId, true);
    expect(diversified[0]?.seriesId).toBe(items[0]!.seriesId);
    // With only one series available, deferred items append — still stable.
    expect(diversified.length).toBe(sameSeries.length);
  });

  it("exploration is deterministic for a seed", () => {
    const a = seededUnit(42);
    const b = seededUnit(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("injects exploration when enabled", () => {
    const items = catalog();
    let profile = createEmptyProfile(1_000);
    const romance = romanceItem(items);
    for (let i = 0; i < 5; i += 1) {
      profile = applySignal(profile, {
        contentId: romance.id,
        seriesId: romance.seriesId,
        genres: romance.genres,
        tropes: romance.tropes,
        language: romance.language,
        action: "complete",
        watchDurationMs: romance.durationMs,
        completionPercentage: 100,
        now: 1_000 + i,
      });
    }
    const ranked = items.map((item) => ({
      contentId: item.id,
      seriesId: item.seriesId,
      source: "affinity" as const,
      reasons: ["similar_taste" as const],
      score: 1,
    }));
    const explored = applyExploration(ranked, items, profile, {
      enabled: true,
      seed: 7,
    });
    expect(explored.some((c) => c.source === "exploration")).toBe(true);
  });
});

describe("service + hostile cases", () => {
  const source = createDeterministicFeedSource(MOCK_CATALOG);
  const items = catalog();

  function service(profile?: UserTasteProfile, enabled = true) {
    const { analytics, events } = makeAnalytics();
    return {
      events,
      svc: createTestRecommendationService({
        catalog: items,
        feedSource: source,
        analytics,
        sessionId: "session_test",
        enabled,
        diversityEnabled: true,
        explorationEnabled: true,
        profile,
      }),
    };
  }

  it("cold start returns valid content", async () => {
    const { svc } = service();
    const result = await svc.getOrderedItems({
      sessionId: "session_test",
      seed: 1,
      language: "en",
      activeSeriesId: null,
      activeContentId: null,
      excludeContentIds: [],
      limit: items.length,
      diversityEnabled: true,
      explorationEnabled: true,
      now: 1_000,
    });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.coldStart).toBe(true);
    const { items: feed } = materializeFeedItems(result, items);
    expect(feed.length).toBe(items.length);
  });

  it("falls back to editorial when disabled / failure path", async () => {
    const { svc } = service(undefined, false);
    const result = await svc.getOrderedItems({
      sessionId: "session_test",
      seed: 1,
      language: "en",
      activeSeriesId: null,
      activeContentId: null,
      excludeContentIds: [],
      limit: items.length,
      diversityEnabled: true,
      explorationEnabled: true,
      now: 1_000,
    });
    expect(result.usedFallback).toBe(true);
    expect(result.items.every((c) => c.source === "editorial")).toBe(true);
  });

  it("skips 20 horror → horror affinity drops", async () => {
    const horror = horrorItem(items);
    const { svc } = service();
    for (let i = 0; i < 20; i += 1) {
      await svc.recordSignal({
        contentId: horror.id,
        seriesId: horror.seriesId,
        genres: horror.genres,
        tropes: horror.tropes,
        language: horror.language,
        action: "skip",
        watchDurationMs: 100,
        completionPercentage: 5,
        now: 1_000 + i,
      });
    }
    const profile = await svc.getProfile();
    expect(profile.likedGenres.horror ?? 0).toBeLessThan(0);
  });

  it("completes 10 romance → romance affinity rises", async () => {
    const romance = romanceItem(items);
    const { svc } = service();
    for (let i = 0; i < 10; i += 1) {
      await svc.recordSignal({
        contentId: romance.id,
        seriesId: romance.seriesId,
        genres: romance.genres,
        tropes: romance.tropes,
        language: romance.language,
        action: "complete",
        watchDurationMs: romance.durationMs,
        completionPercentage: 100,
        now: 1_000 + i,
      });
    }
    const profile = await svc.getProfile();
    expect(profile.likedGenres.romance ?? 0).toBeGreaterThan(5);
  });

  it("follow strongly boosts series affinity", async () => {
    const item = items[0]!;
    const { svc } = service();
    await svc.recordSignal({
      contentId: item.id,
      seriesId: item.seriesId,
      genres: item.genres,
      tropes: item.tropes,
      language: item.language,
      action: "follow",
      watchDurationMs: 0,
      completionPercentage: 50,
      now: 1_000,
    });
    const profile = await svc.getProfile();
    expect(profile.likedSeries[item.seriesId] ?? 0).toBeGreaterThan(1);
  });

  it("repeated same episode stays stable", async () => {
    const item = items[0]!;
    const { svc } = service();
    for (let i = 0; i < 15; i += 1) {
      await svc.recordSignal({
        contentId: item.id,
        seriesId: item.seriesId,
        genres: item.genres,
        tropes: item.tropes,
        language: item.language,
        action: "replay",
        watchDurationMs: item.durationMs,
        completionPercentage: 100,
        now: 1_000 + i,
      });
    }
    const profile = await svc.getProfile();
    expect(Number.isFinite(profile.engagementAffinity)).toBe(true);
    expect(profile.recentHistory.length).toBeLessThanOrEqual(80);
  });

  it("single-language catalog still ranks", async () => {
    const onlyEn = items.map((i) => ({ ...i, language: "en" }));
    const { analytics } = makeAnalytics();
    const svc = createTestRecommendationService({
      catalog: onlyEn,
      feedSource: createDeterministicFeedSource({
        ...MOCK_CATALOG,
        items: onlyEn,
      }),
      analytics,
      sessionId: "session_test",
    });
    const result = await svc.getOrderedItems({
      sessionId: "session_test",
      seed: 3,
      language: "en",
      activeSeriesId: null,
      activeContentId: null,
      excludeContentIds: [],
      limit: onlyEn.length,
      diversityEnabled: true,
      explorationEnabled: true,
      now: 1_000,
    });
    expect(result.items.length).toBe(onlyEn.length);
  });

  it("tiny catalog under diversity target remains stable", async () => {
    const tiny = items.slice(0, 2);
    const { analytics } = makeAnalytics();
    const svc = createTestRecommendationService({
      catalog: tiny,
      feedSource: createDeterministicFeedSource({
        series: MOCK_CATALOG.series,
        items: tiny,
      }),
      analytics,
      sessionId: "session_test",
    });
    const result = await svc.getOrderedItems({
      sessionId: "session_test",
      seed: 9,
      language: "en",
      activeSeriesId: null,
      activeContentId: null,
      excludeContentIds: [],
      limit: 10,
      diversityEnabled: true,
      explorationEnabled: true,
      now: 1_000,
    });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThanOrEqual(tiny.length);
  });

  it("preserves continuation when current has next episode", async () => {
    const { svc } = service();
    const current = items[0]!;
    const next = items.find(
      (i) => i.seriesId === current.seriesId && i.episodeNumber === 2,
    )!;
    const result = await svc.getOrderedItems({
      sessionId: "session_test",
      seed: 1,
      language: "en",
      activeSeriesId: current.seriesId,
      activeContentId: current.id,
      excludeContentIds: [],
      limit: items.length,
      diversityEnabled: true,
      explorationEnabled: true,
      now: 1_000,
    });
    expect(result.items[0]?.contentId).toBe(next.id);
    expect(result.items[0]?.source).toBe("continuation");
  });

  it("series end: no continuation source forced", async () => {
    const { svc } = service();
    const last = items.find(
      (i) => i.seriesId === "series_ember" && i.episodeNumber === 3,
    )!;
    const result = await svc.getOrderedItems({
      sessionId: "session_test",
      seed: 1,
      language: "en",
      activeSeriesId: last.seriesId,
      activeContentId: last.id,
      excludeContentIds: [],
      limit: items.length,
      diversityEnabled: true,
      explorationEnabled: true,
      now: 1_000,
    });
    expect(result.items[0]?.source).not.toBe("continuation");
  });

  it("rapid swipes remain stable", async () => {
    const { svc } = service();
    for (let i = 0; i < 30; i += 1) {
      const item = items[i % items.length]!;
      await svc.recordSignal({
        contentId: item.id,
        seriesId: item.seriesId,
        genres: item.genres,
        tropes: item.tropes,
        language: item.language,
        action: "skip",
        watchDurationMs: 50,
        completionPercentage: 2,
        now: 1_000 + i,
      });
    }
    const result = await svc.getOrderedItems({
      sessionId: "session_test",
      seed: 11,
      language: "en",
      activeSeriesId: null,
      activeContentId: null,
      excludeContentIds: [],
      limit: items.length,
      diversityEnabled: true,
      explorationEnabled: true,
      now: 2_000,
    });
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("emits recommendation analytics with rank + source", async () => {
    const { svc, events } = service();
    await svc.getOrderedItems({
      sessionId: "session_test",
      seed: 1,
      language: "en",
      activeSeriesId: null,
      activeContentId: null,
      excludeContentIds: [],
      limit: items.length,
      diversityEnabled: true,
      explorationEnabled: true,
      now: 1_000,
    });
    expect(events.some((e) => e.event === "recommendation_requested")).toBe(true);
    expect(events.some((e) => e.event === "recommendation_generated")).toBe(true);
    expect(events.some((e) => e.event === "recommendation_source_selected")).toBe(
      true,
    );
    const selected = events.find((e) => e.event === "recommendation_source_selected");
    expect(selected?.properties?.rank_position).toBe(0);
    expect(typeof selected?.properties?.recommendation_source).toBe("string");
  });

  it("rank weights are explicit constants", () => {
    expect(RANK_WEIGHTS.genre).toBeGreaterThan(0);
    expect(RANK_WEIGHTS.skipPenalty).toBeGreaterThan(0);
  });

  it("memory taste store round-trips", async () => {
    const store = createMemoryTasteStore(createEmptyProfile(1));
    const next = applySignal(await store.load(), {
      contentId: "x",
      seriesId: "s",
      genres: ["romance"],
      tropes: [],
      language: "en",
      action: "like",
      watchDurationMs: 0,
      completionPercentage: 0,
      now: 2,
    });
    await store.save(next);
    expect((await store.load()).likedGenres.romance ?? 0).toBeGreaterThan(0);
  });
});
