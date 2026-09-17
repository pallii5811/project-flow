import { describe, expect, it } from "vitest";

import {
  MOCK_CATALOG,
  createDeterministicFeedSource,
  findBySlugs,
  getLaunchFeedCatalog,
  resolveNextInSeries,
  watchPathForItem,
} from "@project-flow/feed-domain";

import {
  ERROR_SKIP_DELAY_MS,
  buildShareUrl,
  firstPlayStartMode,
  isAtSlide,
  settledIndex,
  shouldShowPlayGate,
} from "./feedLogic";
import {
  loadAcquisitionContext,
  parseAcquisitionSearch,
  persistAcquisitionContext,
} from "../../lib/session";

describe("feed.web L1.5", () => {
  const catalog = getLaunchFeedCatalog();
  const source = createDeterministicFeedSource(catalog);
  const items = source.getOrderedItems();
  const item = catalog.items[0]!;

  it("buildShareUrl includes utm + share_id", () => {
    const url = buildShareUrl(catalog, item, "https://flow.example", {
      utmSource: "share",
      utmMedium: "social",
      utmCampaign: "launch",
      shareId: "share_test",
    });
    expect(url).toContain("/watch/signal-night/episode-1");
    expect(url).toContain("utm_source=share");
    expect(url).toContain("utm_medium=social");
    expect(url).toContain("utm_campaign=launch");
    expect(url).toContain("share_id=share_test");
  });

  it("findBySlugs resolves published deep links", () => {
    const found = findBySlugs(MOCK_CATALOG, "signal-night", "episode-2");
    expect(found?.id).toBe("item_signal_2");
    expect(watchPathForItem(catalog, found!)).toBe("/watch/signal-night/episode-2");
  });

  it("resolveNextInSeries continues in-series", () => {
    const first = items.findIndex((entry) => entry.id === "item_signal_1");
    const next = resolveNextInSeries(source, items, first);
    expect(next.kind).toBe("next_in_series");
  });

  it("shouldShowPlayGate is product state not error", () => {
    expect(shouldShowPlayGate(true, false)).toBe(true);
    expect(shouldShowPlayGate(false, false)).toBe(false);
  });
});

describe("acquisition attribution", () => {
  it("parses utm and share_id", () => {
    const parsed = parseAcquisitionSearch(
      "?utm_source=twitter&utm_medium=social&utm_campaign=c1&share_id=share_9",
    );
    expect(parsed.utmSource).toBe("twitter");
    expect(parsed.utmMedium).toBe("social");
    expect(parsed.utmCampaign).toBe("c1");
    expect(parsed.shareId).toBe("share_9");
  });

  it("persists acquisition when sessionStorage exists", () => {
    if (typeof sessionStorage === "undefined") {
      expect(true).toBe(true);
      return;
    }
    sessionStorage.clear();
    const merged = persistAcquisitionContext({
      referrer: "https://t.co/x",
      utmSource: "share",
      utmMedium: "social",
      utmCampaign: null,
      shareId: "share_abc",
    });
    expect(merged.shareId).toBe("share_abc");
    expect(loadAcquisitionContext()?.utmSource).toBe("share");
  });
});

describe("scroll settles before the index moves (PB-6)", () => {
  it("rounds to the nearest slide and stays inside the list", () => {
    expect(settledIndex(0, 800, 5)).toBe(0);
    expect(settledIndex(1_250, 800, 5)).toBe(2);
    expect(settledIndex(99_999, 800, 5)).toBe(4);
    expect(settledIndex(-40, 800, 5)).toBe(0);
    expect(settledIndex(10, 800, 0)).toBeNull();
  });

  it("does not scroll to a slide the scroller already rests on", () => {
    expect(isAtSlide(1_600.5, 1_600)).toBe(true);
    expect(isAtSlide(1_200, 1_600)).toBe(false);
  });
});

describe("first play start mode (MP-2)", () => {
  it("a gate tap is never counted as autoplay", () => {
    expect(
      firstPlayStartMode({ gateTapped: true, resumeLandingId: "a", contentId: "a" }),
    ).toBe("play_gate");
  });

  it("the episode a returning viewer landed on is a resume", () => {
    expect(
      firstPlayStartMode({ gateTapped: false, resumeLandingId: "a", contentId: "a" }),
    ).toBe("resume");
    expect(
      firstPlayStartMode({ gateTapped: false, resumeLandingId: "a", contentId: "b" }),
    ).toBe("autoplay");
  });

  it("the error stays readable before the skip", () => {
    expect(ERROR_SKIP_DELAY_MS).toBeGreaterThanOrEqual(1_500);
  });
});
