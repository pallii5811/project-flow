import { describe, expect, it } from "vitest";

import {
  EMPTY_INSTALL_RECORD,
  INSTALL_OFFER_EPISODES,
  INSTALL_OFFER_MIN_VISIT_MS,
  displayMode,
  installOfferDue,
  installPlatform,
  isIosSafari,
  parseInstallRecord,
  serializeInstallRecord,
} from "./installRules";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1";
const IPHONE_INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0";
const IPHONE_FACEBOOK =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0] Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

const due = {
  platform: "prompt" as const,
  record: EMPTY_INSTALL_RECORD,
  episodesFinished: INSTALL_OFFER_EPISODES,
  visitMs: INSTALL_OFFER_MIN_VISIT_MS,
  blocked: false,
};

describe("when the install invitation may appear", () => {
  it("appears after two finished episodes and a minute, not before", () => {
    expect(installOfferDue(due)).toBe(true);
    expect(installOfferDue({ ...due, episodesFinished: INSTALL_OFFER_EPISODES - 1 })).toBe(false);
    expect(installOfferDue({ ...due, visitMs: INSTALL_OFFER_MIN_VISIT_MS - 1 })).toBe(false);
    expect(installOfferDue({ ...due, episodesFinished: 0, visitMs: 0 })).toBe(false);
  });

  it("pins the thresholds: real engagement, never the first seconds", () => {
    expect(INSTALL_OFFER_EPISODES).toBe(2);
    expect(INSTALL_OFFER_MIN_VISIT_MS).toBe(60_000);
  });

  it("never comes back once shown, whatever the answer, and never to an installed app", () => {
    expect(installOfferDue({ ...due, record: { offeredAt: 1, installed: false } })).toBe(false);
    expect(installOfferDue({ ...due, record: { offeredAt: 0, installed: false } })).toBe(false);
    expect(installOfferDue({ ...due, record: { offeredAt: null, installed: true } })).toBe(false);
  });

  it("never covers something else on screen, and needs a way to install", () => {
    expect(installOfferDue({ ...due, blocked: true })).toBe(false);
    expect(installOfferDue({ ...due, platform: null })).toBe(false);
  });
});

describe("the record of a showing", () => {
  it("round-trips", () => {
    const record = { offeredAt: 1_789_000_000_000, installed: false };
    expect(parseInstallRecord(serializeInstallRecord(record))).toEqual(record);
    expect(parseInstallRecord(null)).toEqual(EMPTY_INSTALL_RECORD);
  });

  it("reads an unreadable record as already shown: silence over a second showing", () => {
    expect(parseInstallRecord("{not json").offeredAt).not.toBeNull();
    expect(installOfferDue({ ...due, record: parseInstallRecord("{not json") })).toBe(false);
  });

  it("ignores fields of the wrong type", () => {
    expect(parseInstallRecord('{"offeredAt":"yesterday","installed":"yes"}')).toEqual(
      EMPTY_INSTALL_RECORD,
    );
  });
});

describe("who gets which invitation", () => {
  it("offers the browser's own prompt when the browser handed one over", () => {
    expect(
      installPlatform({ standalone: false, hasPrompt: true, userAgent: ANDROID_CHROME, maxTouchPoints: 5 }),
    ).toBe("prompt");
  });

  it("offers the Add to Home Screen hint on iOS Safari only", () => {
    expect(isIosSafari(IPHONE_SAFARI, 5)).toBe(true);
    expect(isIosSafari(IPAD_AS_MAC, 5)).toBe(true);
    expect(isIosSafari(IPAD_AS_MAC, 0)).toBe(false);
    for (const inApp of [IPHONE_CHROME, IPHONE_INSTAGRAM, IPHONE_FACEBOOK]) {
      expect(isIosSafari(inApp, 5)).toBe(false);
    }
    expect(
      installPlatform({ standalone: false, hasPrompt: false, userAgent: IPHONE_SAFARI, maxTouchPoints: 5 }),
    ).toBe("ios");
  });

  it("offers nothing where there is no honest way to install", () => {
    expect(
      installPlatform({ standalone: false, hasPrompt: false, userAgent: ANDROID_CHROME, maxTouchPoints: 5 }),
    ).toBeNull();
    expect(
      installPlatform({ standalone: false, hasPrompt: false, userAgent: IPHONE_INSTAGRAM, maxTouchPoints: 5 }),
    ).toBeNull();
  });

  it("offers nothing inside the installed app", () => {
    expect(
      installPlatform({ standalone: true, hasPrompt: true, userAgent: ANDROID_CHROME, maxTouchPoints: 5 }),
    ).toBeNull();
    expect(
      installPlatform({ standalone: true, hasPrompt: false, userAgent: IPHONE_SAFARI, maxTouchPoints: 5 }),
    ).toBeNull();
  });
});

describe("display mode", () => {
  it("tells the installed app from a browser tab", () => {
    const only = (query: string) => (candidate: string) => candidate === query;
    expect(displayMode(() => false, false)).toBe("browser");
    expect(displayMode(() => false, true)).toBe("standalone");
    expect(displayMode(only("(display-mode: standalone)"), false)).toBe("standalone");
    expect(displayMode(only("(display-mode: fullscreen)"), false)).toBe("fullscreen");
    expect(displayMode(only("(display-mode: minimal-ui)"), false)).toBe("minimal-ui");
  });
});
