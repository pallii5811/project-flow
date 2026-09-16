import { describe, expect, it } from "vitest";

import type { AnalyticsClient, AnalyticsEventName } from "@project-flow/analytics";

import { MOCK_CATALOG } from "../feed/data/catalog";
import { createEmptyProfile, applySignal } from "../recommendation/profile/tasteProfile";
import { createTestRecommendationService } from "../recommendation/service/createRecommendationService";
import { createDeterministicFeedSource } from "../feed/source/deterministicFeedSource";
import { aggregateEpisode, aggregateSeries } from "./aggregation/aggregate";
import { createMockSceneGraphDocument } from "./fixtures/mockSceneGraph";
import { ingestSceneGraphDocument } from "./ingestion/ingestSceneGraph";
import { SCHEMA_VERSION } from "./model/taxonomy";
import type { SceneGraphDocument, SceneNode } from "./model/types";
import { getFollowingScene, queryScenes } from "./query/queryScenes";
import { createTestSceneGraphService } from "./service/createSceneGraphService";
import { blendSceneGraphSignals } from "./signals/blendSignals";
import { computeSceneGraphSignals } from "./signals/sceneGraphSignals";
import {
  createMemorySceneGraphStore,
  createUnavailableSceneGraphStore,
} from "./storage/memorySceneGraphStore";
import { validateSceneGraph } from "./validation/validateSceneGraph";

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

function cloneDoc(): SceneGraphDocument {
  return structuredClone(createMockSceneGraphDocument());
}

describe("scene graph model + validation", () => {
  it("accepts the mock fixture document", () => {
    const result = validateSceneGraph(createMockSceneGraphDocument());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects invalid timing (end <= start)", () => {
    const doc = cloneDoc();
    const scene = doc.scenes[0]!;
    scene.endMs = scene.startMs;
    scene.durationMs = 0;
    const result = validateSceneGraph(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "invalid_timing")).toBe(true);
  });

  it("allows adjacent scenes that meet exactly at boundary", () => {
    const doc = cloneDoc();
    const epScenes = doc.scenes
      .filter((s) => s.episodeId === "ep_ember_1")
      .sort((a, b) => a.sequence - b.sequence);
    expect(epScenes[0]!.endMs).toBe(epScenes[1]!.startMs);
    expect(validateSceneGraph(doc).ok).toBe(true);
  });

  it("rejects 1ms overlap", () => {
    const doc = cloneDoc();
    const scenes = doc.scenes
      .filter((s) => s.episodeId === "ep_ember_1")
      .sort((a, b) => a.sequence - b.sequence);
    scenes[1]!.startMs = scenes[0]!.endMs - 1;
    scenes[1]!.durationMs = scenes[1]!.endMs - scenes[1]!.startMs;
    const result = validateSceneGraph(doc);
    expect(result.errors.some((e) => e.code === "overlap")).toBe(true);
  });

  it("rejects unknown character reference", () => {
    const doc = cloneDoc();
    doc.scenes[0]!.characterIds = ["char_does_not_exist"];
    expect(validateSceneGraph(doc).errors.some((e) => e.code === "unknown_character")).toBe(
      true,
    );
  });

  it("rejects unknown episode reference", () => {
    const doc = cloneDoc();
    doc.scenes[0]!.episodeId = "ep_missing";
    expect(validateSceneGraph(doc).errors.some((e) => e.code === "unknown_episode")).toBe(
      true,
    );
  });

  it("rejects invalid trope vocabulary", () => {
    const doc = cloneDoc();
    (doc.scenes[0]!.tropes as string[]) = ["not_a_real_trope"];
    expect(validateSceneGraph(doc).errors.some((e) => e.code === "invalid_trope")).toBe(
      true,
    );
  });

  it("warns on empty episode", () => {
    const doc = cloneDoc();
    doc.scenes = doc.scenes.filter((s) => s.episodeId !== "ep_velvet_2");
    const result = validateSceneGraph(doc);
    expect(result.warnings.some((e) => e.code === "empty_episode")).toBe(true);
  });

  it("warns on low confidence", () => {
    const doc = cloneDoc();
    doc.scenes[0]!.metadataConfidence = 0.2;
    const result = validateSceneGraph(doc);
    expect(result.warnings.some((e) => e.code === "low_confidence")).toBe(true);
  });

  it("supports character aliases without duplicating ids", () => {
    const doc = createMockSceneGraphDocument();
    const lena = doc.characters.find((c) => c.id === "char_lena")!;
    expect(lena.aliases?.includes("Lena")).toBe(true);
    expect(doc.characters.filter((c) => c.canonicalName === "Lena Voss")).toHaveLength(1);
  });

  it("preserves schema + metadata versioning", () => {
    const doc = createMockSceneGraphDocument();
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.metadataVersion).toBe(1);
    expect(doc.scenes.every((s) => s.schemaVersion === SCHEMA_VERSION)).toBe(true);
  });
});

describe("query API", () => {
  const doc = createMockSceneGraphDocument();

  it("filters by genre", () => {
    const results = queryScenes(doc, { genres: ["romance"] });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.scene.genres.includes("romance"))).toBe(true);
  });

  it("filters by trope", () => {
    const results = queryScenes(doc, { tropes: ["betrayal"] });
    expect(results.every((r) => r.scene.tropes.includes("betrayal"))).toBe(true);
  });

  it("composes multi-filter AND query", () => {
    const results = queryScenes(doc, {
      genres: ["romance"],
      tropes: ["betrayal"],
      minEmotionalIntensity: 0.5,
    });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.scene.genres.includes("romance")).toBe(true);
      expect(r.scene.tropes.includes("betrayal")).toBe(true);
      expect((r.scene.emotionalIntensity ?? 0) >= 0.5).toBe(true);
    }
  });

  it("filters by character", () => {
    const results = queryScenes(doc, { characterIds: ["char_lena"] });
    expect(results.every((r) => r.scene.characterIds.includes("char_lena"))).toBe(true);
  });

  it("filters by cliffhanger threshold", () => {
    const results = queryScenes(doc, { minCliffhangerStrength: 0.85 });
    expect(results.every((r) => (r.scene.cliffhangerStrength ?? 0) >= 0.85)).toBe(true);
  });

  it("returns zero for nonexistent combination", () => {
    const results = queryScenes(doc, {
      genres: ["comedy"],
      tropes: ["amnesia"],
      minCliffhangerStrength: 0.99,
    });
    expect(results).toHaveLength(0);
  });

  it("resolves sequence follows relationship", () => {
    const next = getFollowingScene(doc, "sc_ember_1_a");
    expect(next?.id).toBe("sc_ember_1_b");
    expect(getFollowingScene(doc, "sc_ember_1_b")).toBeNull();
  });
});

describe("aggregation", () => {
  const doc = createMockSceneGraphDocument();

  it("aggregates episode from scenes", () => {
    const agg = aggregateEpisode(doc, "ep_ember_1");
    expect(agg).not.toBeNull();
    expect(agg!.sceneCount).toBe(2);
    expect(agg!.episodeGenres).toContain("romance");
    expect(agg!.episodeCliffhangerStrength).toBeGreaterThan(0.5);
  });

  it("aggregates series from scenes", () => {
    const agg = aggregateSeries(doc, "series_ember");
    expect(agg).not.toBeNull();
    expect(agg!.episodeCount).toBe(3);
    expect(agg!.dominantGenres.length).toBeGreaterThan(0);
    expect(agg!.characterSet).toContain("char_lena");
  });
});

describe("ingestion + storage", () => {
  it("ingests valid fixture", () => {
    const result = ingestSceneGraphDocument(createMockSceneGraphDocument());
    expect(result.ok).toBe(true);
  });

  it("rejects malformed ingest", () => {
    const doc = cloneDoc();
    doc.scenes[0]!.episodeId = "nope";
    expect(ingestSceneGraphDocument(doc).ok).toBe(false);
  });

  it("memory store round-trips", async () => {
    const store = createMemorySceneGraphStore();
    const doc = createMockSceneGraphDocument();
    await store.save(doc);
    expect((await store.load())?.scenes.length).toBe(doc.scenes.length);
    expect((await store.getScenesByEpisode("ep_ember_1")).length).toBe(2);
  });

  it("unavailable store fails safely", async () => {
    const store = createUnavailableSceneGraphStore();
    expect(await store.isAvailable()).toBe(false);
    expect(await store.load()).toBeNull();
  });
});

describe("service + recommendation integration", () => {
  it("loads metadata and answers queries", async () => {
    const { analytics, events } = makeAnalytics();
    const svc = await createTestSceneGraphService(analytics);
    expect(await svc.ready()).toBe(true);
    const results = await svc.query({ genres: ["thriller"] });
    expect(results.length).toBeGreaterThan(0);
    expect(events.some((e) => e.event === "scene_metadata_loaded")).toBe(true);
    expect(events.some((e) => e.event === "scene_query_executed")).toBe(true);
  });

  it("returns empty when storage unavailable", async () => {
    const { analytics } = makeAnalytics();
    const svc = await createTestSceneGraphService(analytics, { unavailable: true });
    expect(await svc.ready()).toBe(false);
    expect(await svc.query({ genres: ["romance"] })).toEqual([]);
  });

  it("signals are zero when SCENE_GRAPH_SIGNALS_V0 is off", async () => {
    const { analytics } = makeAnalytics();
    const svc = await createTestSceneGraphService(analytics, { signalsEnabled: false });
    const item = MOCK_CATALOG.items[0]!;
    const signals = await svc.getSignalsForContent(item, createEmptyProfile());
    expect(signals.genreMatch).toBe(0);
    expect(signals.tropeMatch).toBe(0);
  });

  it("computes non-zero signals when enabled and profile has affinity", async () => {
    const { analytics } = makeAnalytics();
    const svc = await createTestSceneGraphService(analytics, { signalsEnabled: true });
    const item = MOCK_CATALOG.items[0]!;
    let profile = createEmptyProfile(1_000);
    for (let i = 0; i < 5; i += 1) {
      profile = applySignal(profile, {
        contentId: item.id,
        seriesId: item.seriesId,
        genres: item.genres,
        tropes: ["betrayal"],
        language: item.language,
        action: "complete",
        watchDurationMs: item.durationMs,
        completionPercentage: 100,
        now: 1_000 + i,
      });
    }
    const signals = await svc.getSignalsForContent(item, profile);
    expect(
      signals.genreMatch + signals.tropeMatch + signals.narrativePatternMatch,
    ).toBeGreaterThan(0);
  });

  it("blend is no-op when disabled", () => {
    const signals = {
      genreMatch: 1,
      tropeMatch: 1,
      emotionalMatch: 1,
      narrativePatternMatch: 1,
      characterPatternMatch: 1,
    };
    expect(blendSceneGraphSignals(1, signals, false)).toBe(1);
    expect(blendSceneGraphSignals(1, signals, true)).toBeGreaterThan(1);
  });

  it("Recommendation V0 still works with Scene Graph disabled", async () => {
    const { analytics } = makeAnalytics();
    const items = createDeterministicFeedSource(MOCK_CATALOG).getOrderedItems();
    const source = createDeterministicFeedSource(MOCK_CATALOG);
    const rec = createTestRecommendationService({
      catalog: items,
      feedSource: source,
      analytics,
      sessionId: "s1",
      enabled: true,
    });
    const result = await rec.getOrderedItems({
      sessionId: "s1",
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
  });

  it("handles large scene catalogs without throwing", () => {
    const doc = cloneDoc();
    const base = doc.scenes[0]!;
    const extra: SceneNode[] = [];
    for (let i = 0; i < 300; i += 1) {
      const start = i * 1000;
      extra.push({
        ...base,
        id: `sc_bulk_${i}`,
        episodeId: "ep_bulk",
        sequence: i,
        startMs: start,
        endMs: start + 1000,
        durationMs: 1000,
      });
    }
    doc.episodes.push({
      id: "ep_bulk",
      seriesId: "series_ember",
      episodeNumber: 99,
      title: "Bulk",
      durationMs: 300_000,
      sceneIds: extra.map((s) => s.id),
    });
    doc.scenes.push(...extra);
    const results = queryScenes(doc, { seriesId: "series_ember" });
    expect(results.length).toBeGreaterThan(300);
  });

  it("computeSceneGraphSignals returns empty without document", () => {
    const item = MOCK_CATALOG.items[0]!;
    const signals = computeSceneGraphSignals(null, item, createEmptyProfile());
    expect(signals.genreMatch).toBe(0);
  });
});
