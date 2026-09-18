import { describe, expect, it } from "vitest";

import {
  FEED_EXTEND_WITHIN,
  FEED_PAGE_SIZE,
  PRODUCER_WITHHELD,
  STRESS_EPISODES_PER_SERIES,
  applyRecommendedPage,
  createDeterministicFeedSource,
  createTestRecommendationService,
  extendFeedPage,
  firstFramePayload,
  fromFeedCatalogPayload,
  getLaunchFeedCatalog,
  needsExtension,
  pageStartingAt,
  parseStressEpisodeCount,
  placeNextInSeries,
  preferLanguage,
  shouldRenderSlide,
  toFeedCatalogPayload,
  validateCatalog,
  withStressEpisodes,
  type ContentItem,
  type FeedCatalog,
} from "./index";
import type { RecommendationCandidate } from "./recommendation/model/types";

const noAnalytics = { track: () => undefined } as unknown as Parameters<
  typeof createTestRecommendationService
>[0]["analytics"];

function withoutDescriptions<T extends Pick<ContentItem, "localizedMetadata">>(item: T): T {
  const localizedMetadata: ContentItem["localizedMetadata"] = {};
  for (const [locale, strings] of Object.entries(item.localizedMetadata)) {
    localizedMetadata[locale] = { title: strings.title, hook: strings.hook };
  }
  return { ...item, localizedMetadata };
}

describe("stress catalog", () => {
  it("reads the size strictly", () => {
    expect(parseStressEpisodeCount(undefined)).toBe(0);
    expect(parseStressEpisodeCount("")).toBe(0);
    expect(parseStressEpisodeCount(" 600 ")).toBe(600);
    expect(() => parseStressEpisodeCount("6OO")).toThrow(/whole number/);
    expect(() => parseStressEpisodeCount("-5")).toThrow(/whole number/);
    expect(() => parseStressEpisodeCount("1000000")).toThrow(/at most/);
  });

  it("keeps the launch pack first and adds valid series of 60", () => {
    const base = getLaunchFeedCatalog();
    const stressed = withStressEpisodes(base, 600);
    expect(validateCatalog(stressed).ok).toBe(true);
    expect(stressed.items).toHaveLength(base.items.length + 600);
    expect(stressed.series).toHaveLength(base.series.length + 600 / STRESS_EPISODES_PER_SERIES);
    expect(stressed.items.slice(0, base.items.length)).toEqual(base.items);

    const source = createDeterministicFeedSource(stressed);
    expect(source.getOrderedItems()[0]?.id).toBe("item_signal_1");
    const posters = new Set(stressed.items.map((item) => item.thumbnailUrl));
    expect(posters.size).toBe(stressed.items.length);
    const tenthOfSecond = stressed.items.find((item) => item.id === "item_stress_2_10")!;
    expect(source.getNextEpisode(tenthOfSecond)?.id).toBe("item_stress_2_11");
    expect(withStressEpisodes(base, 0)).toBe(base);
  });

  it("validates and indexes a very large catalog in linear time", () => {
    const huge = withStressEpisodes(getLaunchFeedCatalog(), 20_000);
    const started = performance.now();
    const source = createDeterministicFeedSource(huge);
    const elapsed = performance.now() - started;
    expect(source.getOrderedItems()).toHaveLength(20_005);
    // Quadratic next-episode checks took about 316 ms at 6,000 episodes, so
    // several seconds at 20,000; linear work stays far below this bound.
    expect(elapsed).toBeLessThan(1_500);
  });
});

describe("feed catalog payload", () => {
  const catalog = withStressEpisodes(getLaunchFeedCatalog(), 120);

  it("round-trips every feed field through JSON", () => {
    const payload = JSON.parse(JSON.stringify(toFeedCatalogPayload(catalog)));
    const restored = fromFeedCatalogPayload(payload);
    const expected = createDeterministicFeedSource(catalog)
      .getOrderedItems()
      .map(withoutDescriptions);
    expect(restored.items).toEqual(expected);
    // Everything the feed shows survives; licence terms and the producer do not travel.
    expect(
      restored.series.map(({ producerId: _p, socialClipsAllowed: _s, rights: _r, ...shown }) => shown),
    ).toEqual(
      catalog.series
        .map(withoutDescriptions)
        .map(({ producerId: _p, socialClipsAllowed: _s, rights: _r, ...shown }) => shown),
    );
    expect(createDeterministicFeedSource(restored).getOrderedItems()).toHaveLength(125);
  });

  it("never sends licence terms or the producer of record to the browser", () => {
    const closes = "2099-01-01T00:00:00.000Z";
    const withTerms: FeedCatalog = {
      ...catalog,
      series: catalog.series.map((entry) => ({
        ...entry,
        producerId: "prod_secret_studio",
        rights: { ...entry.rights, languages: ["en", "es", "ko"], windowEnd: closes },
      })),
    };
    const json = JSON.stringify(toFeedCatalogPayload(withTerms));
    for (const secret of ["prod_secret_studio", "producerId", "territories", "socialClipsAllowed", '"ko"']) {
      expect(json).not.toContain(secret);
    }
    // The one licence fact the client acts on still arrives: when the window closes.
    const restored = fromFeedCatalogPayload(JSON.parse(json));
    expect(restored.series.every((entry) => entry.rights.windowEnd === closes)).toBe(true);
    expect(restored.series.every((entry) => entry.producerId === PRODUCER_WITHHELD)).toBe(true);
    // A window that has closed takes the series out on the client too.
    expect(
      createDeterministicFeedSource(restored, { now: Date.parse(closes) + 1 }).getOrderedItems(),
    ).toHaveLength(0);
  });

  it("never carries descriptions, which the feed does not show", () => {
    const json = JSON.stringify(toFeedCatalogPayload(getLaunchFeedCatalog()));
    expect(json).not.toContain("Pacote vertical liberado");
  });

  it("refuses an item whose derived fields disagree", () => {
    const base = getLaunchFeedCatalog();
    const broken: FeedCatalog = {
      ...base,
      items: base.items.map((item, index) =>
        index === 0 ? { ...item, thumbnailUrl: "/elsewhere.jpg" } : item,
      ),
    };
    expect(() => toFeedCatalogPayload(broken)).toThrow(/thumbnailUrl/);
  });

  it("refuses an unknown payload version", () => {
    expect(() => fromFeedCatalogPayload({ version: 99, series: [], items: [] })).toThrow(
      /version/,
    );
  });

  it("first frame holds only the target and the next episode of its series", () => {
    const home = firstFramePayload(catalog);
    expect(home.items.map((item) => item.id)).toEqual(["item_signal_1", "item_signal_2"]);
    expect(home.series.map((series) => series.id)).toEqual(["series_signal"]);

    const deep = firstFramePayload(catalog, "item_stress_2_7");
    expect(deep.items.map((item) => item.id)).toEqual(["item_stress_2_7", "item_stress_2_8"]);

    // Last episode of a series: the next in feed order instead.
    const last = firstFramePayload(catalog, "item_signal_5");
    expect(last.items.map((item) => item.id)).toEqual(["item_signal_5", "item_stress_1_1"]);

    const end = firstFramePayload(catalog, "item_stress_2_60");
    expect(end.items.map((item) => item.id)).toEqual(["item_stress_2_60"]);

    expect(firstFramePayload(catalog, "no_such_item").items).toEqual([]);
  });

  it("first frame stays small whatever the catalog size", () => {
    const huge = withStressEpisodes(getLaunchFeedCatalog(), 6_000);
    const bytes = JSON.stringify(firstFramePayload(huge, "item_stress_50_3")).length;
    expect(bytes).toBeLessThan(5_000);
  });
});

describe("feed page", () => {
  const source = createDeterministicFeedSource(withStressEpisodes(getLaunchFeedCatalog(), 180));
  const order = source.getOrderedItems();
  const ids = (items: ContentItem[]) => items.map((item) => item.id);

  it("renders media only around the playing slide", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].filter((i) => shouldRenderSlide(i, 4))).toEqual([
      2, 3, 4, 5, 6,
    ]);
  });

  it("extends only near the end of the page", () => {
    expect(needsExtension(40, 40 - FEED_EXTEND_WITHIN - 1)).toBe(false);
    expect(needsExtension(40, 40 - FEED_EXTEND_WITHIN)).toBe(true);
  });

  it("extends from catalog order, without repeating listed episodes", () => {
    const listed = [order[3]!, order[0]!];
    const extended = extendFeedPage(listed, order);
    expect(extended).toHaveLength(2 + FEED_PAGE_SIZE);
    expect(new Set(ids(extended)).size).toBe(extended.length);
    expect(ids(extended.slice(2, 5))).toEqual(ids([order[1]!, order[2]!, order[4]!]));
    const all = extendFeedPage(order, order);
    expect(all).toBe(order);
  });

  it("applies a recommendation after the next slide only", () => {
    const listed = order.slice(0, 6);
    const recommended = [order[5]!, order[50]!, order[1]!, order[60]!];
    const page = applyRecommendedPage(listed, 2, recommended);
    expect(ids(page)).toEqual(ids([...order.slice(0, 4), order[5]!, order[50]!, order[60]!]));
    const capped = applyRecommendedPage(listed, 0, order, 40);
    expect(capped).toHaveLength(42);
  });

  it("continues in the series, placing the next episode when the page lacks it", () => {
    const first = order[0]!;
    const inPage = placeNextInSeries(source, [first, order[7]!, order[1]!], 0);
    expect(inPage.kind === "next_in_series" && inPage.nextIndex).toBe(2);

    const missing = placeNextInSeries(source, [first, order[7]!], 0);
    expect(missing.kind).toBe("next_in_series");
    if (missing.kind === "next_in_series") {
      expect(missing.nextIndex).toBe(1);
      expect(ids(missing.items)).toEqual(ids([first, order[1]!, order[7]!]));
    }

    const lastOfSeries = order.find((item) => item.id === "item_signal_5")!;
    expect(placeNextInSeries(source, [lastOfSeries], 0).kind).toBe("series_complete");
  });

  it("starts a page at a resumed episode followed by its next", () => {
    const resumed = order.find((item) => item.id === "item_stress_1_4")!;
    const page = pageStartingAt(source, resumed, [order[0]!, order[1]!]);
    expect(ids(page)).toEqual([
      "item_stress_1_4",
      "item_stress_1_5",
      "item_signal_1",
      "item_signal_2",
    ]);
  });
});

describe("recommendation at scale", () => {
  const candidate = (contentId: string): RecommendationCandidate => ({
    contentId,
    seriesId: "s",
    source: "editorial",
    reasons: ["editorial"],
    score: 0,
  });

  /** The implementation before speed-6, kept to prove the order is unchanged. */
  function referencePreferLanguage(
    ranked: RecommendationCandidate[],
    byId: Map<string, ContentItem>,
    language: string,
  ) {
    const preferred = ranked.filter((c) => byId.get(c.contentId)?.language === language);
    if (preferred.length >= Math.min(3, ranked.length)) {
      const rest = ranked.filter((c) => !preferred.includes(c));
      return [...preferred, ...rest];
    }
    return ranked;
  }

  it("prefers the viewer language in the same order as before", () => {
    const base = getLaunchFeedCatalog().items[0]!;
    const languages = ["en", "es", "en", "pt", "en", "es", "en", "en", "es"];
    const byId = new Map(
      languages.map((language, i) => [`c${i}`, { ...base, id: `c${i}`, language }]),
    );
    const ranked = languages.map((_, i) => candidate(`c${i}`));
    for (const language of ["en", "es", "pt", "fr"]) {
      expect(preferLanguage(ranked, byId, language)).toEqual(
        referencePreferLanguage(ranked, byId, language),
      );
    }
  });

  it("re-ranks 6,000 episodes with continuation first", async () => {
    const source = createDeterministicFeedSource(
      withStressEpisodes(getLaunchFeedCatalog(), 6_000),
    );
    const items = source.getOrderedItems();
    const service = createTestRecommendationService({
      catalog: items,
      feedSource: source,
      analytics: noAnalytics,
      sessionId: "s",
    });
    const started = performance.now();
    const result = await service.getOrderedItems({
      sessionId: "s",
      language: "en",
      limit: 40,
      seed: 1,
      now: Date.now(),
      excludeContentIds: ["item_signal_1"],
      activeContentId: "item_signal_1",
      activeSeriesId: "series_signal",
      diversityEnabled: true,
      explorationEnabled: true,
    });
    const elapsed = performance.now() - started;
    expect(result.items).toHaveLength(40);
    expect(result.items[0]?.contentId).toBe("item_signal_2");
    // Measured 2026-09-17 on the dev machine: 37 ms. Loose bound for a slow
    // CI machine; the feed runs this after first play, when the main thread
    // is idle.
    expect(elapsed).toBeLessThan(1_000);
  });

  it("keeps the language pass linear in the number of candidates", () => {
    const base = getLaunchFeedCatalog().items[0]!;
    const count = 120_000;
    const byId = new Map<string, ContentItem>();
    const ranked: RecommendationCandidate[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = `c${i}`;
      byId.set(id, { ...base, id, language: i % 2 === 0 ? "en" : "es" });
      ranked.push(candidate(id));
    }
    const started = performance.now();
    const ordered = preferLanguage(ranked, byId, "en");
    const elapsed = performance.now() - started;
    expect(ordered).toHaveLength(count);
    expect(ordered[count / 2 - 1]?.contentId).toBe(`c${count - 2}`);
    expect(ordered[count / 2]?.contentId).toBe("c1");
    // Measured 2026-09-17 on the dev machine: the includes-based version took
    // 1,893 ms on these 120,000 candidates, this single pass 33 ms.
    expect(elapsed).toBeLessThan(400);
  });
});
