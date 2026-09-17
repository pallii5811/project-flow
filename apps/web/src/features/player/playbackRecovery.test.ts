import { describe, expect, it } from "vitest";

import {
  NETWORK_RETRY_DELAYS_MS,
  decideFatalRecovery,
  decideWatchdog,
  reattachPosition,
  seekTarget,
  shouldFallBackToMuted,
} from "./playbackRecovery";

const network = { kind: "network" as const, online: true, networkRetries: 0, mediaRecoveries: 0 };

describe("decideFatalRecovery (PB-1)", () => {
  it("retries a transient network failure with growing delays, then fails", () => {
    expect(decideFatalRecovery(network)).toEqual({
      action: "retry",
      delayMs: NETWORK_RETRY_DELAYS_MS[0],
    });
    expect(decideFatalRecovery({ ...network, networkRetries: 1 })).toEqual({
      action: "retry",
      delayMs: NETWORK_RETRY_DELAYS_MS[1],
    });
    expect(
      decideFatalRecovery({ ...network, networkRetries: NETWORK_RETRY_DELAYS_MS.length }),
    ).toEqual({ action: "fail", mediaErrorCode: 2 });
  });

  it("waits for the network instead of spending retries while offline", () => {
    expect(decideFatalRecovery({ ...network, online: false, networkRetries: 9 })).toEqual({
      action: "wait_online",
    });
  });

  it("fails at once on a missing file, but retries throttling and timeouts", () => {
    expect(decideFatalRecovery({ ...network, httpStatus: 404 })).toEqual({
      action: "fail",
      mediaErrorCode: 2,
    });
    expect(decideFatalRecovery({ ...network, httpStatus: 429 }).action).toBe("retry");
    expect(decideFatalRecovery({ ...network, httpStatus: 503 }).action).toBe("retry");
  });

  it("recovers a media error once, then fails as a decode error", () => {
    const media = { ...network, kind: "media" as const };
    expect(decideFatalRecovery(media)).toEqual({ action: "recover_media" });
    expect(decideFatalRecovery({ ...media, mediaRecoveries: 1 })).toEqual({
      action: "fail",
      mediaErrorCode: 3,
    });
  });
});

describe("decideWatchdog", () => {
  it("re-attaches once, then fails", () => {
    expect(decideWatchdog({ online: true, reattached: false, waitingForViewer: false })).toBe(
      "reattach",
    );
    expect(decideWatchdog({ online: true, reattached: true, waitingForViewer: false })).toBe(
      "fail",
    );
  });

  it("never fails a paused or gated episode, and waits while offline", () => {
    expect(decideWatchdog({ online: true, reattached: true, waitingForViewer: true })).toBe(
      "ignore",
    );
    expect(decideWatchdog({ online: false, reattached: true, waitingForViewer: false })).toBe(
      "wait_online",
    );
  });
});

describe("reattachPosition", () => {
  it("continues just before the stall point", () => {
    expect(reattachPosition(4)).toBeCloseTo(3.75);
  });

  it("starts from the beginning near the start or without a position", () => {
    expect(reattachPosition(0.2)).toBeNull();
    expect(reattachPosition(Number.NaN)).toBeNull();
  });
});

describe("seekTarget (PB-2)", () => {
  it("lands on the saved position", () => {
    expect(seekTarget(6_000, 10)).toBe(6);
  });

  it("never lands in the last 5% of the episode", () => {
    expect(seekTarget(9_900, 10)).toBe(9.5);
  });

  it("an empty request is no seek", () => {
    expect(seekTarget(null, 10)).toBeNull();
    expect(seekTarget(0, 10)).toBeNull();
  });

  it("an unknown duration keeps the requested position", () => {
    expect(seekTarget(3_000, Number.NaN)).toBe(3);
  });
});

describe("shouldFallBackToMuted (PB-3)", () => {
  const notAllowed = new DOMException("needs a gesture", "NotAllowedError");

  it("falls back only when sound was on and play was refused", () => {
    expect(shouldFallBackToMuted(notAllowed, false)).toBe(true);
    expect(shouldFallBackToMuted(notAllowed, true)).toBe(false);
    expect(shouldFallBackToMuted(new DOMException("interrupted", "AbortError"), false)).toBe(
      false,
    );
  });
});
