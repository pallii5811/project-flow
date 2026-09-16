import { describe, expect, it } from "vitest";

import type { AnalyticsClient, AnalyticsEventName } from "@project-flow/analytics";

import { MOCK_CATALOG } from "../feed/data/catalog";
import { createDeterministicFeedSource } from "../feed/source/deterministicFeedSource";
import { createIntentParser } from "../intent/parser/createIntentParser";
import { createIntentService } from "../intent/service/createIntentService";
import { findClosestContent } from "./closest/findClosestContent";
import {
  buildCanonicalKey,
  normalizeFromIntent,
  patternIdFromKey,
} from "./normalize/normalizeDemand";
import {
  createDemandGraphService,
  hashAnonymousId,
} from "./service/createDemandGraphService";
import { createUnavailableDemandStore } from "./storage/memoryDemandStore";

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
const parser = createIntentParser();

function intentCtx() {
  return {
    contentId: catalog[0]!.id,
    seriesId: catalog[0]!.seriesId,
    episodeId: catalog[0]!.episodeId,
    genres: catalog[0]!.genres,
    tropes: catalog[0]!.tropes,
    language: "en",
    recentContentIds: [],
  };
}

describe("demand normalization + keys", () => {
  it("maps equivalent intents to the same canonical key", () => {
    const base = parser.parseChip("MORE_REVENGE", intentCtx()).intent;
    const a = buildCanonicalKey(normalizeFromIntent(base));
    const alt = {
      ...base,
      genres: ["revenge" as const],
      tropes: ["revenge" as const],
    };
    const b = buildCanonicalKey(normalizeFromIntent(alt));
    expect(a).toBe(b);
    expect(patternIdFromKey(a)).toBe(patternIdFromKey(b));
  });

  it("does not invent unsupported dimensions", () => {
    const intent = parser.parseChip("STRONG_FEMALE_LEAD", intentCtx()).intent;
    const n = normalizeFromIntent(intent);
    expect(n.unresolvedFields.length).toBeGreaterThan(0);
    expect(n.preferFemaleLead).toBe(true);
  });
});

describe("closest content", () => {
  it("finds closest catalog item for a revenge pattern", () => {
    const n = normalizeFromIntent(
      parser.parseChip("MORE_REVENGE", intentCtx()).intent,
    );
    const closest = findClosestContent(n, catalog);
    expect(closest).not.toBeNull();
    expect(closest!.overlapScore).toBeGreaterThan(0);
  });
});

describe("demand graph service", () => {
  it("deduplicates the same session/intent event", async () => {
    const { analytics } = makeAnalytics();
    const svc = createDemandGraphService({
      analytics,
      catalog,
      enabled: true,
    });
    const intent = parser.parseChip("DARKER", intentCtx()).intent;
    const input = {
      source: "intent_weak_match" as const,
      intent,
      resultCount: 0,
      matchStrength: 0.1,
      anonymousIdHash: "u1",
      dedupeKey: "same_key",
      language: "en",
    };
    const first = await svc.ingest(input);
    const second = await svc.ingest(input);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("one obsessive user does not inflate unique_users", async () => {
    const { analytics } = makeAnalytics();
    const svc = createDemandGraphService({
      analytics,
      catalog,
      enabled: true,
      thresholds: { possibleGapUniqueUsers: 2, maxRequestsPerUserCounted: 5 },
    });
    const intent = parser.parseChip("MORE_ROMANCE", intentCtx()).intent;
    for (let i = 0; i < 100; i += 1) {
      await svc.ingest({
        source: "intent_unresolved",
        intent: { ...intent, intentId: `i_${i}` },
        resultCount: 0,
        matchStrength: 0,
        anonymousIdHash: "obsessive",
        dedupeKey: `obs_${i}`,
      });
    }
    const patterns = await svc.query();
    expect(patterns[0]!.evidence.uniqueUsers).toBe(1);
    expect(patterns[0]!.evidence.requestCount).toBe(100);
    expect(patterns[0]!.evidence.cappedRequestCount).toBe(5);
  });

  it("100 unique users each once increases unique_users", async () => {
    const { analytics } = makeAnalytics();
    const svc = createDemandGraphService({
      analytics,
      catalog,
      enabled: true,
      thresholds: {
        possibleGapUniqueUsers: 3,
        repeatedGapUniqueUsers: 8,
        repeatedGapRequestCount: 8,
      },
    });
    const intent = parser.parseChip("MORE_REVENGE", intentCtx()).intent;
    for (let i = 0; i < 100; i += 1) {
      await svc.ingest({
        source: "intent_weak_match",
        intent: { ...intent, intentId: `u_${i}` },
        resultCount: 1,
        matchStrength: 0.2,
        anonymousIdHash: `user_${i}`,
        dedupeKey: `u_${i}`,
        language: "en",
      });
    }
    const pattern = (await svc.query())[0]!;
    expect(pattern.evidence.uniqueUsers).toBe(100);
    expect(pattern.state).toBe("REPEATED_GAP");
  });

  it("zero-result with no related behavior stays possible/repeated, not validated", async () => {
    const { analytics } = makeAnalytics();
    const svc = createDemandGraphService({
      analytics,
      catalog,
      enabled: true,
      thresholds: { possibleGapUniqueUsers: 2, repeatedGapUniqueUsers: 3, repeatedGapRequestCount: 3 },
    });
    const intent = parser.parseChip("DARKER", intentCtx()).intent;
    for (let i = 0; i < 5; i += 1) {
      await svc.ingest({
        source: "intent_unresolved",
        intent: { ...intent, intentId: `z_${i}` },
        resultCount: 0,
        matchStrength: 0,
        anonymousIdHash: `zuser_${i}`,
        dedupeKey: `z_${i}`,
      });
    }
    const pattern = (await svc.query())[0]!;
    expect(pattern.state).not.toBe("BEHAVIORALLY_VALIDATED");
  });

  it("related completions can validate a content gap", async () => {
    const { analytics } = makeAnalytics();
    const svc = createDemandGraphService({
      analytics,
      catalog,
      enabled: true,
      thresholds: {
        possibleGapUniqueUsers: 2,
        repeatedGapUniqueUsers: 3,
        repeatedGapRequestCount: 3,
        validatedUniqueUsers: 5,
        validatedMinRelatedPlays: 5,
        validatedCompletionRate: 0.4,
      },
    });
    const intent = parser.parseChip("MORE_REVENGE", intentCtx()).intent;
    const closest = findClosestContent(normalizeFromIntent(intent), catalog)!;
    for (let i = 0; i < 12; i += 1) {
      await svc.ingest({
        source: "intent_weak_match",
        intent: { ...intent, intentId: `v_${i}` },
        resultCount: 1,
        matchStrength: 0.2,
        anonymousIdHash: `vu_${i}`,
        dedupeKey: `v_${i}`,
        relatedContentId: closest.contentId,
      });
    }
    for (let i = 0; i < 10; i += 1) {
      await svc.recordRelatedBehavior({
        contentId: closest.contentId,
        kind: "play",
        anonymousIdHash: `vu_${i}`,
      });
      await svc.recordRelatedBehavior({
        contentId: closest.contentId,
        kind: "complete",
        anonymousIdHash: `vu_${i}`,
      });
    }
    const pattern = (await svc.query())[0]!;
    expect(pattern.gapKind).toBe("CONTENT_GAP");
    expect(pattern.state).toBe("BEHAVIORALLY_VALIDATED");
    expect(pattern.confidenceLevel).not.toBe("low");
  });

  it("distinguishes INTENT_GAP from CONTENT_GAP", async () => {
    const { analytics } = makeAnalytics();
    const svc = createDemandGraphService({ analytics, catalog, enabled: true });
    const unresolved = await parser.parse("xyzzy unknown flute", intentCtx());
    await svc.ingest({
      source: "intent_unresolved",
      intent: unresolved.intent,
      resultCount: 0,
      matchStrength: 0,
      anonymousIdHash: "ig1",
      dedupeKey: "ig1",
    });
    const patterns = await svc.query({ gapKind: "INTENT_GAP" });
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0]!.state).not.toBe("BEHAVIORALLY_VALIDATED");
  });

  it("preserves language segments", async () => {
    const { analytics } = makeAnalytics();
    const svc = createDemandGraphService({ analytics, catalog, enabled: true });
    const intent = parser.parseChip("MORE_ROMANCE", intentCtx()).intent;
    await svc.ingest({
      source: "intent_weak_match",
      intent,
      resultCount: 1,
      matchStrength: 0.2,
      anonymousIdHash: "br1",
      dedupeKey: "br1",
      language: "pt",
      country: "BR",
    });
    await svc.ingest({
      source: "intent_weak_match",
      intent: { ...intent, intentId: "x2" },
      resultCount: 1,
      matchStrength: 0.2,
      anonymousIdHash: "us1",
      dedupeKey: "us1",
      language: "en",
      country: "US",
    });
    const pattern = (await svc.query())[0]!;
    expect(pattern.segments.byLanguage.pt).toBe(1);
    expect(pattern.segments.byLanguage.en).toBe(1);
    expect(pattern.segments.byCountry.BR).toBe(1);
  });

  it("fails safe when storage unavailable", async () => {
    const { analytics } = makeAnalytics();
    const svc = createDemandGraphService({
      analytics,
      catalog,
      enabled: true,
      store: createUnavailableDemandStore(),
    });
    expect(await svc.ready()).toBe(false);
    const intent = parser.parseChip("DARKER", intentCtx()).intent;
    expect(
      await svc.ingest({
        source: "intent_unresolved",
        intent,
        resultCount: 0,
        matchStrength: 0,
        anonymousIdHash: "x",
        dedupeKey: "x",
      }),
    ).toBeNull();
  });

  it("disabled flag returns null / empty", async () => {
    const { analytics } = makeAnalytics();
    const svc = createDemandGraphService({
      analytics,
      catalog,
      enabled: false,
    });
    expect(await svc.ready()).toBe(false);
    expect(await svc.query()).toEqual([]);
  });

  it("does not auto-satisfy; requires post-launch evidence", async () => {
    const { analytics } = makeAnalytics();
    const svc = createDemandGraphService({
      analytics,
      catalog,
      enabled: true,
      thresholds: {
        validatedUniqueUsers: 3,
        validatedMinRelatedPlays: 3,
        validatedCompletionRate: 0.3,
        possibleGapUniqueUsers: 2,
        repeatedGapUniqueUsers: 3,
        repeatedGapRequestCount: 3,
      },
    });
    const intent = parser.parseChip("MORE_REVENGE", intentCtx()).intent;
    const closest = findClosestContent(normalizeFromIntent(intent), catalog)!;
    for (let i = 0; i < 8; i += 1) {
      await svc.ingest({
        source: "intent_weak_match",
        intent: { ...intent, intentId: `s_${i}` },
        resultCount: 1,
        matchStrength: 0.15,
        anonymousIdHash: `su_${i}`,
        dedupeKey: `s_${i}`,
        relatedContentId: closest.contentId,
      });
      await svc.recordRelatedBehavior({
        contentId: closest.contentId,
        kind: "play",
        anonymousIdHash: `su_${i}`,
      });
      await svc.recordRelatedBehavior({
        contentId: closest.contentId,
        kind: "complete",
        anonymousIdHash: `su_${i}`,
      });
    }
    const pattern = (await svc.query())[0]!;
    expect(pattern.state).toBe("BEHAVIORALLY_VALIDATED");
    const refused = await svc.markSatisfied({
      patternId: pattern.patternId,
      contentIds: [closest.contentId],
      impressions: 10,
      plays: 0,
      completions: 0,
    });
    expect(refused).toBeNull();
    const ok = await svc.markSatisfied({
      patternId: pattern.patternId,
      contentIds: [closest.contentId],
      impressions: 10,
      plays: 5,
      completions: 3,
    });
    expect(ok?.state).toBe("SATISFIED");
  });

  it("production signal foundation excludes forecasts", async () => {
    const { analytics } = makeAnalytics();
    const svc = createDemandGraphService({
      analytics,
      catalog,
      enabled: true,
      thresholds: {
        validatedUniqueUsers: 3,
        validatedMinRelatedPlays: 3,
        validatedCompletionRate: 0.3,
        possibleGapUniqueUsers: 2,
        repeatedGapUniqueUsers: 3,
        repeatedGapRequestCount: 3,
      },
    });
    const intent = parser.parseChip("MORE_REVENGE", intentCtx()).intent;
    const closest = findClosestContent(normalizeFromIntent(intent), catalog)!;
    for (let i = 0; i < 8; i += 1) {
      await svc.ingest({
        source: "intent_weak_match",
        intent: { ...intent, intentId: `p_${i}` },
        resultCount: 1,
        matchStrength: 0.15,
        anonymousIdHash: `pu_${i}`,
        dedupeKey: `p_${i}`,
        relatedContentId: closest.contentId,
      });
      await svc.recordRelatedBehavior({
        contentId: closest.contentId,
        kind: "play",
        anonymousIdHash: `pu_${i}`,
      });
      await svc.recordRelatedBehavior({
        contentId: closest.contentId,
        kind: "complete",
        anonymousIdHash: `pu_${i}`,
      });
    }
    const pattern = (await svc.query())[0]!;
    const prod = await svc.promoteToProductionSignal(pattern.patternId);
    expect(prod).not.toBeNull();
    expect(prod!.disclaimer.toLowerCase()).toContain("not");
    expect(prod!.confidenceNote.toLowerCase()).not.toContain("guaranteed");
  });

  it("Intent integration hook fires without blocking", async () => {
    const { analytics, events } = makeAnalytics();
    const demand = createDemandGraphService({
      analytics,
      catalog,
      enabled: true,
    });
    const intentSvc = createIntentService({
      analytics,
      sessionId: "sess",
      catalog,
      onDemandSignal: (resolution) => {
        void demand.ingestFromIntentResolution(resolution, {
          anonymousIdHash: hashAnonymousId("sess"),
        });
      },
    });
    await intentSvc.resolveChip("MORE_ROMANCE", intentCtx());
    // allow microtask
    await new Promise((r) => setTimeout(r, 10));
    const patterns = await demand.query();
    expect(patterns.length).toBeGreaterThan(0);
    expect(events.some((e) => e.event === "intent_chip_selected")).toBe(true);
  });

  it("missing anonymous id still hashes safely", async () => {
    const { analytics } = makeAnalytics();
    const svc = createDemandGraphService({ analytics, catalog, enabled: true });
    const intent = parser.parseChip("SURPRISE_ME", intentCtx()).intent;
    const pattern = await svc.ingest({
      source: "intent_resolved",
      intent,
      resultCount: 2,
      matchStrength: 0.5,
      anonymousIdHash: "",
      dedupeKey: "empty_anon",
    });
    expect(pattern).not.toBeNull();
  });
});
