import { describe, expect, it } from "vitest";

import {
  ACTIVE_BUFFER_SECONDS,
  ACTIVE_MAX_BUFFER_SECONDS,
  DEFAULT_START_ESTIMATE_BPS,
  NEXT_EPISODE_WARM_CEILING_SECONDS,
  NEXT_EPISODE_WARM_SECONDS,
  HLS_ENGINE_CHUNK_PLACEHOLDER,
  buildHlsWarmupScript,
  chooseHlsEngine,
  isHlsSource,
  isCrossOriginMedia,
  isSafariUserAgent,
  needsCrossOriginMedia,
  planHlsLoad,
  shouldWarmHlsEngine,
  startQuality,
} from "./hlsSupport";

describe("needsCrossOriginMedia — a subtitle from another host needs CORS, or it never loads", () => {
  it("asks for nothing while media is served by the site itself", () => {
    expect(
      needsCrossOriginMedia([
        "/content/series/signal-night/hls/episode-1/ab12cd34ef56/master.m3u8",
        "/content/series/signal-night/captions/episode-1.en.vtt",
      ]),
    ).toBe(false);
    expect(needsCrossOriginMedia([])).toBe(false);
    expect(needsCrossOriginMedia([null, undefined])).toBe(false);
  });

  it("asks for it as soon as one URL is on the media host", () => {
    expect(
      needsCrossOriginMedia([
        "https://media.cliffies.app/content/series/x/hls/episode-1/ab12cd34ef56/master.m3u8",
        "/content/series/x/captions/episode-1.en.vtt",
      ]),
    ).toBe(true);
    // Video in the export, subtitles on the media host: still needed.
    expect(
      needsCrossOriginMedia(["/content/x.m3u8", "https://media.cliffies.app/content/x.en.vtt"]),
    ).toBe(true);
  });

  it("tells one URL from the other, which is how the poster stays out of CORS", () => {
    expect(isCrossOriginMedia("https://media.cliffies.app/content/x.webp")).toBe(true);
    expect(isCrossOriginMedia("/content/series/x/posters/episode-1.webp")).toBe(false);
    expect(isCrossOriginMedia(null)).toBe(false);
  });
});

describe("isHlsSource", () => {
  it("recognizes HLS by MIME type or by playlist extension", () => {
    expect(isHlsSource("application/vnd.apple.mpegurl", "/x/master")).toBe(true);
    expect(isHlsSource("Application/X-MpegURL", "/x/master")).toBe(true);
    expect(isHlsSource("", "/content/ep1/master.m3u8?v=2")).toBe(true);
    expect(isHlsSource("video/mp4", "/content/ep1.mp4")).toBe(false);
  });
});

describe("chooseHlsEngine", () => {
  it("keeps Safari on its native engine", () => {
    expect(
      chooseHlsEngine({
        canPlayNativeHls: true,
        mediaSourceSupported: true,
        isSafari: true,
      }),
    ).toBe("native");
  });

  it("uses hls.js wherever Media Source exists, even if the browser claims native HLS", () => {
    expect(
      chooseHlsEngine({
        canPlayNativeHls: true,
        mediaSourceSupported: true,
        isSafari: false,
      }),
    ).toBe("hlsjs");
    expect(
      chooseHlsEngine({
        canPlayNativeHls: false,
        mediaSourceSupported: true,
        isSafari: false,
      }),
    ).toBe("hlsjs");
  });

  it("falls back to native, then admits it cannot play", () => {
    expect(
      chooseHlsEngine({
        canPlayNativeHls: true,
        mediaSourceSupported: false,
        isSafari: false,
      }),
    ).toBe("native");
    expect(
      chooseHlsEngine({
        canPlayNativeHls: false,
        mediaSourceSupported: false,
        isSafari: false,
      }),
    ).toBe("unsupported");
  });
});

describe("isSafariUserAgent", () => {
  it("tells Safari from browsers that also say Safari", () => {
    const iphoneSafari =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
    const androidChrome =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
    const iphoneChrome =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1";
    expect(isSafariUserAgent(iphoneSafari)).toBe(true);
    expect(isSafariUserAgent(androidChrome)).toBe(false);
    expect(isSafariUserAgent(iphoneChrome)).toBe(false);
  });
});

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

describe("shouldWarmHlsEngine — early hls.js download, never for Safari", () => {
  it("warms only where hls.js will play", () => {
    expect(shouldWarmHlsEngine({ isSafari: false, mediaSourceSupported: true })).toBe(true);
    expect(shouldWarmHlsEngine({ isSafari: true, mediaSourceSupported: true })).toBe(false);
    expect(shouldWarmHlsEngine({ isSafari: false, mediaSourceSupported: false })).toBe(
      false,
    );
  });
});

describe("buildHlsWarmupScript — engine and playlist requested before hydration", () => {
  type FakeLink = Record<string, string>;
  const ENGINE = "/_next/static/chunks/dd0d9434.816eaef6db7f4c5c.js";

  /** Runs the script as the exported page would, after the post-build link step. */
  function run(
    userAgent: string,
    withMediaSource: boolean,
    urls: string[],
    linked = true,
  ): FakeLink[] {
    const appended: FakeLink[] = [];
    const fakeWindow: Record<string, unknown> = withMediaSource ? { MediaSource: {} } : {};
    const fakeDocument = {
      createElement: () => ({}) as FakeLink,
      head: { appendChild: (link: FakeLink) => appended.push(link) },
    };
    let script = buildHlsWarmupScript(urls);
    if (linked) script = script.replace(HLS_ENGINE_CHUNK_PLACEHOLDER, ENGINE);
    new Function("window", "navigator", "document", script)(
      fakeWindow,
      { userAgent },
      fakeDocument,
    );
    return appended;
  }

  it("preloads the engine chunk and the playlist as a CORS fetch hls.js reuses", () => {
    expect(run(ANDROID_CHROME, true, ["/hls/episode-1/master.m3u8"])).toEqual([
      { rel: "preload", as: "script", href: ENGINE },
      {
        rel: "preload",
        as: "fetch",
        crossOrigin: "anonymous",
        href: "/hls/episode-1/master.m3u8",
      },
    ]);
  });

  it("skips the engine when the build step did not link it (next dev)", () => {
    expect(run(ANDROID_CHROME, true, ["/a.m3u8"], false).map((link) => link.as)).toEqual([
      "fetch",
    ]);
  });

  it("costs Safari nothing, and browsers without Media Source nothing", () => {
    expect(run(IPHONE_SAFARI, true, ["/a.m3u8"])).toEqual([]);
    expect(run(ANDROID_CHROME, false, ["/a.m3u8"])).toEqual([]);
  });

  it("contains the placeholder exactly once, and no URL can close the script", () => {
    const script = buildHlsWarmupScript(["/x</script><script>alert(1)//.m3u8"]);
    expect(script.split(HLS_ENGINE_CHUNK_PLACEHOLDER)).toHaveLength(2);
    expect(script).not.toContain("</script>");
    expect(run(ANDROID_CHROME, true, ["/x</script>.m3u8"])[1]?.href).toBe(
      "/x</script>.m3u8",
    );
  });
});

describe("planHlsLoad — current fully warm, next only its first seconds", () => {
  it("buffers the active episode normally", () => {
    expect(planHlsLoad(true, "auto")).toEqual({
      load: "segments",
      targetBufferSeconds: ACTIVE_BUFFER_SECONDS,
      maxBufferSeconds: ACTIVE_MAX_BUFFER_SECONDS,
    });
  });

  it("warms only the first seconds of the next episode, with a hard ceiling", () => {
    // hls.js reads maxBufferLength as a floor: the ceiling must be capped too.
    expect(planHlsLoad(false, "auto")).toEqual({
      load: "segments",
      targetBufferSeconds: NEXT_EPISODE_WARM_CEILING_SECONDS,
      maxBufferSeconds: NEXT_EPISODE_WARM_CEILING_SECONDS,
    });
    expect(NEXT_EPISODE_WARM_SECONDS).toBeLessThanOrEqual(4);
    // Under two 2-second segments: with audio muxed in, the buffered range is
    // the video/audio intersection and lands milliseconds short of 4.000 s, so
    // a ceiling of exactly 4 s bought a third segment (measured 2026-09-18).
    expect(NEXT_EPISODE_WARM_CEILING_SECONDS).toBeLessThan(4);
    expect(NEXT_EPISODE_WARM_CEILING_SECONDS).toBeGreaterThan(2);
  });

  it("downloads no media for the previous episode", () => {
    expect(planHlsLoad(false, "metadata").load).toBe("manifest");
  });
});

describe("startQuality", () => {
  it("uses a sane default without hints", () => {
    expect(startQuality({})).toEqual({
      estimateBps: DEFAULT_START_ESTIMATE_BPS,
      capToLowest: false,
    });
  });

  it("follows the measured downlink with headroom and bounds", () => {
    expect(startQuality({ downlinkMbps: 5 }).estimateBps).toBe(4_000_000);
    expect(startQuality({ downlinkMbps: 0.1 }).estimateBps).toBe(300_000);
    expect(startQuality({ downlinkMbps: 50 }).estimateBps).toBe(10_000_000);
  });

  it("treats an unreadable downlink as unknown, not as zero", () => {
    expect(startQuality({ downlinkMbps: Number.NaN }).estimateBps).toBe(
      DEFAULT_START_ESTIMATE_BPS,
    );
  });

  it("respects Data Saver", () => {
    expect(startQuality({ saveData: true, downlinkMbps: 8 }).capToLowest).toBe(true);
  });
});
