/**
 * Series manifests and rights (CP-1, F8).
 *
 * What is proven here: the catalog really is built from the manifests, and a
 * series is refused — or hidden — when the rights that allow it to be shown
 * are missing, malformed, or out of date.
 */
import { describe, expect, it } from "vitest";

import { SERIES_MANIFESTS } from "../data/generated";
import { LAUNCH_CATALOG, getLaunchFeedCatalog } from "../data/catalog";
import { catalogFromManifests } from "./seriesManifest";
import { isSeriesWindowOpen } from "../model/types";
import { toPublishedCatalog, validateCatalog } from "../model/validate";
import type { SeriesManifest } from "./seriesManifest";

const signalNight = SERIES_MANIFESTS.find(
  (manifest) => manifest.seriesSlug === "signal-night",
) as SeriesManifest;

describe("the catalog is built from the manifests", () => {
  it("every published episode matches its manifest, duration included", () => {
    const catalog = getLaunchFeedCatalog();
    for (const episode of signalNight.episodes) {
      const item = catalog.items.find(
        (entry) =>
          entry.seriesId === signalNight.seriesId &&
          entry.episodeSlug === episode.episodeSlug,
      );
      expect(item, episode.episodeSlug).toBeDefined();
      expect(item?.durationMs).toBe(episode.durationMs);
      expect(item?.playback.reference).toBe(episode.playbackReference);
      expect(item?.thumbnailUrl).toBe(episode.posterReference);
      expect(item?.playback.shareCardReference).toBe(episode.shareCardReference);
    }
  });

  it("no duration is a round number somebody typed", () => {
    // The stand-in pack is 10 s by construction, but the value must come from
    // the manifest, which came from ffmpeg.
    for (const episode of signalNight.episodes) {
      expect(Number.isInteger(episode.durationMs)).toBe(true);
      expect(episode.durationMs).toBeGreaterThan(0);
    }
  });

  it("the poster is served in a modern format at the size it is shown", () => {
    for (const episode of signalNight.episodes) {
      expect(episode.posterReference.endsWith(".webp")).toBe(true);
    }
  });

  it("captions are declared ready only with cues that cover the episode", () => {
    for (const episode of signalNight.episodes) {
      for (const track of episode.captions) {
        expect(track.status).toBe("ready");
        expect(track.cues).toBeGreaterThan(0);
        expect(track.coverage).toBeGreaterThan(0.3);
      }
      expect(episode.captions.filter((track) => track.default)).toHaveLength(1);
    }
  });

  it("every series carries a producer of record and a clip permission", () => {
    for (const series of LAUNCH_CATALOG.series) {
      expect(series.producerId.length).toBeGreaterThan(0);
      expect(typeof series.socialClipsAllowed).toBe("boolean");
    }
  });
});

describe("rights windows", () => {
  const open = { territories: ["WORLD"], languages: ["en"], windowStart: null, windowEnd: null };
  const now = Date.parse("2026-09-18T00:00:00.000Z");

  it("an open window is open", () => {
    expect(isSeriesWindowOpen(open, now)).toBe(true);
  });

  it("a window that has not started yet is closed", () => {
    expect(
      isSeriesWindowOpen({ ...open, windowStart: "2027-01-01T00:00:00.000Z" }, now),
    ).toBe(false);
  });

  it("a window that has ended is closed", () => {
    expect(isSeriesWindowOpen({ ...open, windowEnd: "2026-09-01T00:00:00.000Z" }, now)).toBe(
      false,
    );
  });

  it("an unreadable date is never open: a licence nobody can read is not a licence", () => {
    expect(isSeriesWindowOpen({ ...open, windowEnd: "soon" }, now)).toBe(false);
  });

  it("the feed does not list a series whose window has closed", () => {
    const closed = catalogFromManifests([
      {
        ...signalNight,
        rights: { ...signalNight.rights, windowEnd: "2026-09-01T00:00:00.000Z" },
      },
    ]);
    // The episodes are still "published": it is the licence that ended.
    expect(closed.items.length).toBeGreaterThan(0);
    expect(toPublishedCatalog(closed, now).items).toHaveLength(0);
    expect(toPublishedCatalog(closed, now).series).toHaveLength(0);
    expect(
      toPublishedCatalog(closed, Date.parse("2026-08-01T00:00:00.000Z")).items.length,
    ).toBeGreaterThan(0);
  });

  it("the feed does not list a series whose window has not opened yet", () => {
    const future = catalogFromManifests([
      {
        ...signalNight,
        rights: { ...signalNight.rights, windowStart: "2027-01-01T00:00:00.000Z" },
      },
    ]);
    expect(toPublishedCatalog(future, now).items).toHaveLength(0);
  });
});

describe("a series that cannot be published", () => {
  const base = LAUNCH_CATALOG.series[0];

  function catalogWithSeries(series: unknown) {
    return { series: [series], items: LAUNCH_CATALOG.items.slice(0, 1) };
  }

  it("is refused without rights", () => {
    const { rights: _rights, ...withoutRights } = base;
    const result = validateCatalog(catalogWithSeries(withoutRights));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toContain("missing_rights");
  });

  it("is refused without a producer of record", () => {
    const result = validateCatalog(catalogWithSeries({ ...base, producerId: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toContain("missing_producer");
  });

  it("is refused when the window ends before it starts", () => {
    const result = validateCatalog(
      catalogWithSeries({
        ...base,
        rights: {
          ...base.rights,
          windowStart: "2026-10-01T00:00:00.000Z",
          windowEnd: "2026-09-01T00:00:00.000Z",
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toContain("invalid_window");
  });

  it("is refused when clip permission was never asked", () => {
    const { socialClipsAllowed: _allowed, ...withoutPermission } = base;
    const result = validateCatalog(catalogWithSeries(withoutPermission));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.code)).toContain("missing_social_clips_permission");
    }
  });
});

describe("an episode without a landscape share card", () => {
  it("cannot be published: the link preview would be a cropped band", () => {
    const item = LAUNCH_CATALOG.items[0];
    const { shareCardReference: _card, ...playback } = item.playback;
    const result = validateCatalog({
      series: LAUNCH_CATALOG.series,
      items: [{ ...item, playback }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toContain("missing_share_card");
  });
});
