import { describe, expect, it } from "vitest";

import {
  LAUNCH_CATALOG,
  MOCK_CATALOG,
  createDeterministicFeedSource,
  createStaticVideoProvider,
  createWatchProgressThrottle,
  createWebPerfTiming,
  findBySlugs,
  getLaunchFeedCatalog,
  parseContentItem,
  resolveLocalizedStrings,
  selectCaptionTrack,
  toPublishedCatalog,
  validateCatalog,
} from "./index";

describe("launch catalog", () => {
  it("publishes Signal Night with vertical cleared assets only", () => {
    const catalog = getLaunchFeedCatalog();
    expect(catalog.series).toHaveLength(1);
    expect(catalog.series[0]?.seriesSlug).toBe("signal-night");
    expect(catalog.items.length).toBeGreaterThanOrEqual(3);
    for (const item of catalog.items) {
      expect(item.status).toBe("published");
      expect(item.playback.width / item.playback.height).toBeLessThan(0.65);
      expect(item.videoUrl.includes("picsum")).toBe(false);
      expect(item.videoUrl.includes("gtv-videos")).toBe(false);
      expect(item.videoUrl.startsWith("/content/")).toBe(true);
      expect(item.captions.some((t) => t.status === "ready")).toBe(true);
    }
  });

  it("MOCK_CATALOG alias is published launch feed", () => {
    expect(MOCK_CATALOG.items.every((i) => i.status === "published")).toBe(true);
  });

  it("excludes draft unpublished expired from published catalog", () => {
    const published = toPublishedCatalog(LAUNCH_CATALOG);
    expect(published.items.some((i) => i.status === "draft")).toBe(false);
    expect(published.items.some((i) => i.id === "item_draft_probe_1")).toBe(false);
    expect(published.items.some((i) => i.id === "item_signal_expired_probe")).toBe(false);
    expect(published.items.some((i) => i.id === "item_signal_unpublished_probe")).toBe(false);
  });

  it("rejects malformed content missing playback", () => {
    expect(() => parseContentItem({ id: "x" })).toThrow(/malformed|Invalid/);
  });

  it("validateCatalog reports aspect ratio failures", () => {
    const bad = {
      ...LAUNCH_CATALOG,
      items: [
        {
          ...LAUNCH_CATALOG.items[0]!,
          id: "bad_aspect",
          episodeSlug: "bad-aspect",
          playback: {
            ...LAUNCH_CATALOG.items[0]!.playback,
            width: 1920,
            height: 1080,
            aspectRatio: 1920 / 1080,
          },
        },
      ],
    };
    const result = validateCatalog(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "invalid_aspect_ratio")).toBe(true);
    }
  });

  it("validateCatalog rejects invalid MIME", () => {
    const bad = {
      ...LAUNCH_CATALOG,
      items: [
        {
          ...LAUNCH_CATALOG.items[0]!,
          id: "bad_mime",
          episodeSlug: "bad-mime",
          playback: {
            ...LAUNCH_CATALOG.items[0]!.playback,
            mimeType: "video/avi",
          },
        },
      ],
    };
    const result = validateCatalog(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "invalid_mime")).toBe(true);
    }
  });
});

describe("deep links", () => {
  it("resolves published watch targets", () => {
    const item = findBySlugs(LAUNCH_CATALOG, "signal-night", "episode-1");
    expect(item?.id).toBe("item_signal_1");
  });

  it("rejects draft and unpublished routes", () => {
    expect(findBySlugs(LAUNCH_CATALOG, "draft-probe", "episode-1")).toBeNull();
    expect(findBySlugs(LAUNCH_CATALOG, "signal-night", "unpublished-probe")).toBeNull();
    expect(findBySlugs(LAUNCH_CATALOG, "signal-night", "expired-probe")).toBeNull();
  });

  it("rejects invalid slug", () => {
    expect(findBySlugs(LAUNCH_CATALOG, "missing", "episode-1")).toBeNull();
  });
});

describe("playback provider", () => {
  const provider = createStaticVideoProvider();

  it("resolves static descriptors", () => {
    const item = getLaunchFeedCatalog().items[0]!;
    const result = provider.resolve(item.playback);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.playback.url).toContain("/content/series/signal-night/");
      expect(result.playback.posterUrl).toContain("/posters/");
    }
  });

  it("fails expired descriptors", () => {
    const item = LAUNCH_CATALOG.items.find((i) => i.id === "item_signal_expired_probe")!;
    const result = provider.resolve(item.playback, Date.now());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("EXPIRED");
  });

  it("fails missing source", () => {
    const item = getLaunchFeedCatalog().items[0]!;
    const result = provider.resolve({ ...item.playback, reference: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MISSING_SOURCE");
  });
});

describe("captions + locale", () => {
  it("selects default ready track", () => {
    const item = getLaunchFeedCatalog().items[0]!;
    const track = selectCaptionTrack(item.captions, "en");
    expect(track?.language).toBe("en");
    expect(track?.url.endsWith(".vtt")).toBe(true);
  });

  it("falls back when locale missing", () => {
    const item = getLaunchFeedCatalog().items[0]!;
    const track = selectCaptionTrack(item.captions, "ja");
    expect(track?.language).toBe("en");
  });

  it("resolves localized metadata with fallback", () => {
    const item = getLaunchFeedCatalog().items[0]!;
    const es = resolveLocalizedStrings(item.localizedMetadata, "es", "en");
    expect(es?.title).toBeTruthy();
    const missing = resolveLocalizedStrings(item.localizedMetadata, "ja", "en");
    expect(missing?.title).toBe(item.localizedMetadata.en?.title);
  });

  it("handles missing caption tracks", () => {
    expect(selectCaptionTrack([], "en")).toBeNull();
    expect(
      selectCaptionTrack(
        [{ language: "en", url: "/x.vtt", kind: "captions", default: true, status: "failed" }],
        "en",
      ),
    ).toBeNull();
  });
});

describe("feed source publishedOnly", () => {
  it("never returns draft items", () => {
    const source = createDeterministicFeedSource(LAUNCH_CATALOG);
    expect(source.getOrderedItems().every((i) => i.status === "published")).toBe(true);
  });
});

describe("watch progress throttle", () => {
  it("emits on thresholds and interval, not every tick", () => {
    const throttle = createWatchProgressThrottle(5_000);
    const id = "item_a";
    expect(throttle.shouldEmit({ contentId: id, positionMs: 100, durationMs: 1000 }, 0)).toBe(
      true,
    ); // 10%
    expect(throttle.shouldEmit({ contentId: id, positionMs: 110, durationMs: 1000 }, 100)).toBe(
      false,
    );
    expect(throttle.shouldEmit({ contentId: id, positionMs: 250, durationMs: 1000 }, 200)).toBe(
      true,
    ); // 25%
    expect(throttle.shouldEmit({ contentId: id, positionMs: 260, durationMs: 1000 }, 1000)).toBe(
      false,
    );
    expect(throttle.shouldEmit({ contentId: id, positionMs: 300, durationMs: 1000 }, 5200)).toBe(
      true,
    ); // interval
  });
});

describe("web perf timing", () => {
  it("computes deltas between marks", () => {
    const marks = createWebPerfTiming(() => 5000);
    marks.mark("video_load_started", 5100);
    marks.mark("video_can_play", 5200);
    marks.mark("first_meaningful_play", 5300);
    expect(marks.delta("video_load_started", "video_can_play")).toBe(100);
    expect(marks.timeToFirstPlay()).toBeGreaterThanOrEqual(0);
  });
});
