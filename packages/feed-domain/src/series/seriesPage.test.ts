import { describe, expect, it } from "vitest";

import { getLaunchFeedCatalog, LAUNCH_CATALOG } from "../data/catalog";
import type { FeedCatalog } from "../model/types";
import { browseCatalog, browseGenres, seriesPageData, seriesPageSlugs } from "./seriesPage";

const catalog = getLaunchFeedCatalog();

describe("seriesPageSlugs", () => {
  it("lists every series that has something to watch", () => {
    expect(seriesPageSlugs(catalog)).toEqual(["signal-night"]);
  });

  it("lists no series whose licence window has closed", () => {
    const closed: FeedCatalog = {
      ...catalog,
      series: catalog.series.map((series) => ({
        ...series,
        rights: { ...series.rights, windowEnd: "2020-01-01T00:00:00.000Z" },
      })),
    };
    expect(seriesPageSlugs(closed)).toEqual([]);
    expect(seriesPageData(closed, "signal-night")).toBeNull();
  });
});

describe("seriesPageData", () => {
  it("is built from what really plays, in order", () => {
    const data = seriesPageData(catalog, "signal-night");
    expect(data).not.toBeNull();
    expect(data?.title).toBe("Signal Night");
    expect(data?.episodes.map((episode) => episode.episodeNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(data?.episodes[0]?.href).toBe("/watch/signal-night/episode-1");
    expect(data?.totalDurationMs).toBe(
      data?.episodes.reduce((total, episode) => total + episode.durationMs, 0),
    );
    // Every poster and card it names is a real asset of that episode.
    for (const episode of data?.episodes ?? []) {
      expect(episode.posterUrl.startsWith("/content/")).toBe(true);
      expect(episode.durationMs).toBeGreaterThan(0);
    }
    expect(data?.shareCardUrl).toContain("/share/");
  });

  it("never lists a draft, unpublished or expired episode", () => {
    const data = seriesPageData(LAUNCH_CATALOG, "signal-night");
    const ids = (data?.episodes ?? []).map((episode) => episode.contentId);
    expect(ids).not.toContain("item_draft_probe_1");
    expect(ids).not.toContain("item_signal_expired_probe");
    expect(ids).not.toContain("item_signal_unpublished_probe");
  });

  it("reads hooks as prose, not as the two lines the feed draws", () => {
    const data = seriesPageData(catalog, "signal-night");
    expect(data?.hook).not.toContain("\n");
    for (const episode of data?.episodes ?? []) {
      expect(episode.hook).not.toContain("\n");
    }
  });

  it("does not exist for an unknown slug", () => {
    expect(seriesPageData(catalog, "no-such-series")).toBeNull();
  });
});

describe("browseCatalog", () => {
  it("lists every series that has a page, with the page's own numbers", () => {
    const listing = browseCatalog(catalog);
    expect(listing.map((entry) => entry.seriesSlug)).toEqual(["signal-night"]);
    const [first] = listing;
    expect(first?.href).toBe("/series/signal-night");
    expect(first?.episodeCount).toBe(seriesPageData(catalog, "signal-night")?.episodes.length);
    expect(first?.genres.length).toBeGreaterThan(0);
  });

  it("names each genre once, the most used first", () => {
    const listing = [
      { seriesSlug: "a", title: "A", hook: "", genres: ["thriller", "romance"], episodeCount: 1, posterUrl: "", href: "" },
      { seriesSlug: "b", title: "B", hook: "", genres: ["romance"], episodeCount: 1, posterUrl: "", href: "" },
    ];
    expect(browseGenres(listing)).toEqual(["romance", "thriller"]);
    expect(browseGenres([])).toEqual([]);
  });
});
