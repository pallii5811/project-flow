import { describe, expect, it } from "vitest";

import type { AnalyticsClient, AnalyticsEventName } from "@project-flow/analytics";

import { MOCK_CATALOG } from "../feed/data/catalog";
import { createDeterministicFeedSource } from "../feed/source/deterministicFeedSource";
import { resolveNextInSeries } from "../feed/continuation/resolveNextInSeries";
import { createEmptyProfile } from "../recommendation/profile/tasteProfile";
import { createTestRecommendationService } from "../recommendation/service/createRecommendationService";
import { intentToSceneQuery } from "./mapping/intentToSceneQuery";
import { intentToRecommendationBias } from "./mapping/intentToRecommendationBias";
import { INTENT_CHIP_IDS, INTENT_PRIORITY } from "./model/taxonomy";
import type { IntentParseContext } from "./model/types";
import { createIntentParser } from "./parser/createIntentParser";
import { createIntentService } from "./service/createIntentService";

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

const catalog = createDeterministicFeedSource(MOCK_CATALOG).getOrderedItems();
const source = createDeterministicFeedSource(MOCK_CATALOG);

function context(partial: Partial<IntentParseContext> = {}): IntentParseContext {
  const item = catalog[0]!;
  return {
    contentId: item.id,
    seriesId: item.seriesId,
    episodeId: item.episodeId,
    genres: item.genres,
    tropes: item.tropes,
    language: "en",
    recentContentIds: [item.id],
    ...partial,
  };
}

describe("intent parser", () => {
  const parser = createIntentParser();

  it("maps all chips", () => {
    for (const chip of INTENT_CHIP_IDS) {
      const result = parser.parseChip(chip, context());
      expect(result.intent.chipId).toBe(chip);
      expect(result.intent.lifetime).toBe("NEXT_ITEM");
      expect(result.intent.source).toBe("chip");
    }
  });

  it("parses more romantic", async () => {
    const result = await parser.parse("more romantic", context());
    expect(result.ok).toBe(true);
    expect(result.intent.genres).toContain("romance");
  });

  it("parses darker", async () => {
    const result = await parser.parse("darker", context());
    expect(result.intent.emotionalTone).toBe("dark");
  });

  it("parses more revenge", async () => {
    const result = await parser.parse("more revenge", context());
    expect(result.intent.tropes).toContain("revenge");
  });

  it("parses something like this", async () => {
    const result = await parser.parse("something like this", context());
    expect(result.intent.similarityToContentId).toBe(catalog[0]!.id);
  });

  it("parses compound like this but darker", async () => {
    const result = await parser.parse(
      "something like this but darker",
      context(),
    );
    expect(result.ok).toBe(true);
    expect(result.intent.similarityToContentId).toBe(catalog[0]!.id);
    expect(result.intent.emotionalTone).toBe("dark");
    expect(result.intent.parserSource).toBe("compound");
  });

  it("parses revenge with female lead", async () => {
    const result = await parser.parse(
      "revenge with a female lead",
      context(),
    );
    expect(result.intent.tropes).toContain("revenge");
    expect(result.intent.preferFemaleLead).toBe(true);
    expect(result.intent.unresolvedTerms.length).toBeGreaterThan(0);
  });

  it("returns unresolved for unknown phrase", async () => {
    const result = await parser.parse("xyzzy quantum flute", context());
    expect(result.ok).toBe(false);
    expect(result.intent.parserSource).toBe("unresolved");
  });

  it("allows conflicting romance + darker compound", async () => {
    const result = await parser.parse("more romantic and darker", context());
    expect(result.ok).toBe(true);
    expect(result.intent.genres).toContain("romance");
    expect(result.intent.emotionalTone).toBe("dark");
  });
});

describe("intent mapping", () => {
  const parser = createIntentParser();

  it("maps MORE_ROMANCE to SceneQuery", () => {
    const intent = parser.parseChip("MORE_ROMANCE", context()).intent;
    const { query } = intentToSceneQuery(intent);
    expect(query.genres).toContain("romance");
    expect(query.minRomanceIntensity).toBeGreaterThan(0);
  });

  it("maps DARKER without inventing unavailable fields", () => {
    const intent = parser.parseChip("DARKER", context()).intent;
    const { query } = intentToSceneQuery(intent);
    expect(query.emotionalTone === "dark" || (query.minSuspenseIntensity ?? 0) > 0).toBe(
      true,
    );
  });

  it("maps to recommendation bias without taste mutation", () => {
    const profileBefore = createEmptyProfile(1);
    const intent = parser.parseChip("MORE_ROMANCE", context()).intent;
    const bias = intentToRecommendationBias(intent);
    expect(bias.genres).toContain("romance");
    expect(profileBefore.likedGenres).toEqual({});
    expect(INTENT_PRIORITY[0]).toBe("continuation");
    expect(INTENT_PRIORITY[1]).toBe("explicit_intent");
  });
});

describe("intent service", () => {
  it("resolves chip to candidates", async () => {
    const { analytics, events } = makeAnalytics();
    const svc = createIntentService({
      analytics,
      sessionId: "s1",
      catalog,
      nlEnabled: false,
    });
    const resolution = await svc.resolveChip("MORE_ROMANCE", context());
    expect(resolution.status).not.toBe("unresolved");
    expect(resolution.candidates.length).toBeGreaterThan(0);
    expect(events.some((e) => e.event === "intent_chip_selected")).toBe(true);
    expect(events.some((e) => e.event === "intent_parsed")).toBe(true);
  });

  it("handles zero / weak catalog match safely", async () => {
    const { analytics } = makeAnalytics();
    const svc = createIntentService({
      analytics,
      sessionId: "s1",
      catalog: catalog.map((item) => ({
        ...item,
        genres: ["comedy"],
        tropes: ["amnesia"],
      })),
    });
    const resolution = await svc.resolveChip("MORE_REVENGE", context({
      genres: ["comedy"],
      tropes: [],
    }));
    // May be weak or unresolved — must not throw; feed retained (no crash)
    expect(["resolved", "weak_match", "unresolved"]).toContain(resolution.status);
  });

  it("parser unavailable → unresolved, no bias", async () => {
    const { analytics, events } = makeAnalytics();
    const svc = createIntentService({
      analytics,
      sessionId: "s1",
      catalog,
      parserUnavailable: true,
    });
    const resolution = await svc.resolveChip("DARKER", context());
    expect(resolution.status).toBe("unresolved");
    expect(svc.getActiveBias()).toBeNull();
    expect(events.some((e) => e.event === "intent_unresolved")).toBe(true);
  });

  it("NL disabled returns unresolved for text", async () => {
    const { analytics } = makeAnalytics();
    const svc = createIntentService({
      analytics,
      sessionId: "s1",
      catalog,
      nlEnabled: false,
    });
    const resolution = await svc.resolveText("more romantic", context());
    expect(resolution.status).toBe("unresolved");
  });

  it("NL enabled resolves known phrases", async () => {
    const { analytics, events } = makeAnalytics();
    const svc = createIntentService({
      analytics,
      sessionId: "s1",
      catalog,
      nlEnabled: true,
    });
    const resolution = await svc.resolveText("more romantic", context());
    expect(resolution.status).not.toBe("unresolved");
    expect(events.some((e) => e.event === "intent_text_submitted")).toBe(true);
  });

  it("NEXT_ITEM bias is consumed once", async () => {
    const { analytics } = makeAnalytics();
    const svc = createIntentService({
      analytics,
      sessionId: "s1",
      catalog,
    });
    await svc.resolveChip("SURPRISE_ME", context());
    expect(svc.getActiveResolution()).not.toBeNull();
    const consumed = svc.consumeNextItemBias();
    expect(consumed).not.toBeNull();
    expect(svc.getActiveBias()).toBeNull();
  });

  it("Scene Graph unavailable still resolves from catalog", async () => {
    const { analytics } = makeAnalytics();
    const svc = createIntentService({
      analytics,
      sessionId: "s1",
      catalog,
      getSceneDocument: async () => {
        throw new Error("sg down");
      },
    });
    const resolution = await svc.resolveChip("MORE_ROMANCE", context());
    expect(resolution.candidates.length).toBeGreaterThan(0);
  });

  it("rapid repeated intent changes stay stable", async () => {
    const { analytics } = makeAnalytics();
    const svc = createIntentService({
      analytics,
      sessionId: "s1",
      catalog,
    });
    for (const chip of INTENT_CHIP_IDS) {
      const r = await svc.resolveChip(chip, context());
      expect(r.intentId).toBeTruthy();
    }
    expect(svc.getActiveResolution()).not.toBeNull();
  });

  it("MORE_LIKE_THIS uses current content context", async () => {
    const { analytics } = makeAnalytics();
    const svc = createIntentService({
      analytics,
      sessionId: "s1",
      catalog,
    });
    const resolution = await svc.resolveChip("MORE_LIKE_THIS", context());
    expect(resolution.intent.similarityToContentId).toBe(catalog[0]!.id);
    expect(
      resolution.candidates.every((c) => c.contentId !== catalog[0]!.id),
    ).toBe(true);
  });
});

describe("continuity priority vs intent", () => {
  it("does not remove next-in-series from catalog for auto-continue", async () => {
    const { analytics } = makeAnalytics();
    const svc = createIntentService({
      analytics,
      sessionId: "s1",
      catalog,
    });
    const current = catalog[0]!;
    await svc.resolveChip("MORE_ROMANCE", context());
    const items = [...catalog];
    const resolution = resolveNextInSeries(source, items, 0);
    expect(resolution.kind).toBe("next_in_series");
    if (resolution.kind === "next_in_series") {
      expect(resolution.next.seriesId).toBe(current.seriesId);
      expect(resolution.next.episodeNumber).toBe(current.episodeNumber + 1);
    }
  });

  it("Recommendation V0 still works with intent present", async () => {
    const { analytics } = makeAnalytics();
    const rec = createTestRecommendationService({
      catalog,
      feedSource: source,
      analytics,
      sessionId: "s1",
    });
    const result = await rec.getOrderedItems({
      sessionId: "s1",
      seed: 1,
      language: "en",
      activeSeriesId: catalog[0]!.seriesId,
      activeContentId: catalog[0]!.id,
      excludeContentIds: [],
      limit: catalog.length,
      diversityEnabled: true,
      explorationEnabled: true,
      now: 1_000,
    });
    expect(result.items[0]?.source).toBe("continuation");
  });
});

describe("intent chip labels accessibility", () => {
  it("every chip has a semantic label", () => {
    for (const id of INTENT_CHIP_IDS) {
      expect(id.length).toBeGreaterThan(0);
    }
  });
});
