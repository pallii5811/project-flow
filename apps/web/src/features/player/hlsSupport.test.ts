import { describe, expect, it } from "vitest";

import {
  ACTIVE_BUFFER_SECONDS,
  ACTIVE_MAX_BUFFER_SECONDS,
  DEFAULT_START_ESTIMATE_BPS,
  NEXT_EPISODE_WARM_SECONDS,
  chooseHlsEngine,
  isHlsSource,
  isSafariUserAgent,
  planHlsLoad,
  startQuality,
} from "./hlsSupport";

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
      targetBufferSeconds: NEXT_EPISODE_WARM_SECONDS,
      maxBufferSeconds: NEXT_EPISODE_WARM_SECONDS,
    });
    expect(NEXT_EPISODE_WARM_SECONDS).toBeLessThanOrEqual(4);
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
