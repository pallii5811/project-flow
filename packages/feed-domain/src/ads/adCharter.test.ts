import { describe, expect, it } from "vitest";

import {
  AD_CHARTER,
  createAdSession,
  evaluateAdBreak,
  evaluateSponsorCard,
  recordInterruption,
  recordWatchedTime,
  type AdPlacementContext,
  type AdSessionState,
} from "./adCharter";

const MIN = 60_000;
const T0 = 1_000_000;

/** Watches `minutes` of content in one go, ending at wall clock `T0 + minutes`. */
function watch(state: AdSessionState, minutes: number): AdSessionState {
  return recordWatchedTime(state, minutes * MIN, state.lastWatchedAtMs + minutes * MIN);
}

function boundary(
  state: AdSessionState,
  extra: Partial<AdPlacementContext> = {},
): AdPlacementContext {
  return {
    nowMs: state.lastWatchedAtMs,
    atEpisodeBoundary: true,
    surfaceOpen: false,
    viewerMuted: false,
    ...extra,
  };
}

function adBreak(state: AdSessionState, durationMs = 30_000): AdSessionState {
  return recordInterruption(
    state,
    { kind: "ad_break", durationMs, seriesId: null },
    state.lastWatchedAtMs,
  );
}

describe("AD_CHARTER values are pinned (changing one needs a decision entry)", () => {
  it("matches docs/standard.md §2 exactly", () => {
    expect(AD_CHARTER).toEqual({
      sessionGraceWatchedMs: 600_000,
      minWatchedMsBetweenInterruptions: 600_000,
      maxAdBreakMs: 30_000,
      maxSponsorCardMs: 3_000,
      maxAdMsPerViewingHour: 180_000,
      viewingHourMs: 3_600_000,
      sessionIdleResetMs: 1_800_000,
    });
  });
});

describe("evaluateAdBreak — grace", () => {
  it("never interrupts before the first episode of a session", () => {
    const fresh = createAdSession(T0);
    expect(evaluateAdBreak(fresh, boundary(fresh))).toEqual({
      allowed: false,
      reason: "session_grace",
    });
  });

  it("denies one millisecond before 10 watched minutes and allows at exactly 10", () => {
    const almost = recordWatchedTime(createAdSession(T0), 10 * MIN - 1, T0 + 10 * MIN);
    expect(evaluateAdBreak(almost, boundary(almost))).toEqual({
      allowed: false,
      reason: "session_grace",
    });
    const exactly = recordWatchedTime(almost, 1, T0 + 10 * MIN + 1);
    expect(evaluateAdBreak(exactly, boundary(exactly))).toEqual({
      allowed: true,
      maxDurationMs: 30_000,
      startMuted: false,
    });
  });

  it("counts watched time, not wall-clock time: an open, paused app earns nothing", () => {
    const paused = recordWatchedTime(createAdSession(T0), 2 * MIN, T0 + 25 * MIN);
    expect(evaluateAdBreak(paused, boundary(paused))).toMatchObject({
      reason: "session_grace",
    });
  });
});

describe("evaluateAdBreak — placement", () => {
  const ready = watch(createAdSession(T0), 12);

  it("never inside an episode", () => {
    expect(evaluateAdBreak(ready, boundary(ready, { atEpisodeBoundary: false }))).toEqual(
      {
        allowed: false,
        reason: "not_episode_boundary",
      },
    );
  });

  it("never over an open sheet", () => {
    expect(evaluateAdBreak(ready, boundary(ready, { surfaceOpen: true }))).toEqual({
      allowed: false,
      reason: "surface_open",
    });
  });

  it("never unmutes a muted viewer", () => {
    expect(evaluateAdBreak(ready, boundary(ready, { viewerMuted: true }))).toEqual({
      allowed: true,
      maxDurationMs: 30_000,
      startMuted: true,
    });
  });
});

describe("evaluateAdBreak — spacing", () => {
  it("needs 10 watched minutes after the previous break", () => {
    const afterFirst = adBreak(watch(createAdSession(T0), 10));
    const tooSoon = recordWatchedTime(
      afterFirst,
      10 * MIN - 1,
      afterFirst.lastWatchedAtMs + 10 * MIN,
    );
    expect(evaluateAdBreak(tooSoon, boundary(tooSoon))).toEqual({
      allowed: false,
      reason: "too_soon_after_last_interruption",
    });
    const onTime = recordWatchedTime(tooSoon, 1, tooSoon.lastWatchedAtMs + 1);
    expect(evaluateAdBreak(onTime, boundary(onTime))).toMatchObject({ allowed: true });
  });
});

describe("evaluateAdBreak — rolling hourly cap", () => {
  /** Six 30 s breaks at watched minutes 10, 20, 30, 40, 50, 60. */
  function sixBreaks(): AdSessionState {
    let state = createAdSession(T0);
    for (let i = 0; i < 6; i += 1) {
      state = adBreak(watch(state, 10));
    }
    return state;
  }

  it("refuses a seventh 30 s break inside the same 60 watched minutes", () => {
    const at70 = watch(sixBreaks(), 10);
    expect(at70.watchedMs).toBe(70 * MIN);
    expect(evaluateAdBreak(at70, boundary(at70))).toEqual({
      allowed: false,
      reason: "hourly_cap_reached",
    });
  });

  it("allows it once the oldest break leaves the window", () => {
    const at70 = watch(sixBreaks(), 10);
    const later = recordWatchedTime(at70, 1, at70.lastWatchedAtMs + 1);
    expect(evaluateAdBreak(later, boundary(later))).toEqual({
      allowed: true,
      maxDurationMs: 30_000,
      startMuted: false,
    });
  });

  it("shrinks the break to the budget that is left", () => {
    let state = createAdSession(T0);
    // 5 × 34 s = 170 s: only 10 s of the hourly budget remains.
    for (let i = 0; i < 5; i += 1) {
      state = adBreak(watch(state, 10), 34_000);
    }
    const next = watch(state, 10);
    expect(evaluateAdBreak(next, boundary(next))).toEqual({
      allowed: true,
      maxDurationMs: 10_000,
      startMuted: false,
    });
  });

  it("records real durations: an overrun eats the budget instead of vanishing", () => {
    const overrun = adBreak(watch(createAdSession(T0), 10), 200_000);
    const next = watch(overrun, 10);
    expect(evaluateAdBreak(next, boundary(next))).toEqual({
      allowed: false,
      reason: "hourly_cap_reached",
    });
  });
});

describe("session idle reset", () => {
  it("starts a new session with a new grace after 30 minutes without watching", () => {
    const watched = watch(createAdSession(T0), 15);
    const returning = boundary(watched, { nowMs: watched.lastWatchedAtMs + 30 * MIN });
    expect(evaluateAdBreak(watched, returning)).toEqual({
      allowed: false,
      reason: "session_grace",
    });
  });

  it("keeps the session one millisecond before the reset", () => {
    const watched = watch(createAdSession(T0), 15);
    const stillHere = boundary(watched, {
      nowMs: watched.lastWatchedAtMs + 30 * MIN - 1,
    });
    expect(evaluateAdBreak(watched, stillHere)).toMatchObject({ allowed: true });
  });

  it("drops the previous session's watched time when watching resumes", () => {
    const watched = watch(createAdSession(T0), 15);
    const resumed = recordWatchedTime(watched, MIN, watched.lastWatchedAtMs + 45 * MIN);
    expect(resumed.watchedMs).toBe(MIN);
    expect(resumed.ledger).toEqual([]);
  });
});

describe("recordWatchedTime — unknown is not zero", () => {
  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])(
    "ignores a delta of %s",
    (delta) => {
      const state = watch(createAdSession(T0), 3);
      expect(recordWatchedTime(state, delta, state.lastWatchedAtMs + MIN)).toBe(state);
    },
  );

  it("ignores an interruption with an unknown duration", () => {
    const state = watch(createAdSession(T0), 12);
    expect(
      recordInterruption(
        state,
        { kind: "ad_break", durationMs: Number.NaN, seriesId: null },
        T0,
      ),
    ).toBe(state);
  });
});

describe("evaluateSponsorCard", () => {
  const ready = watch(createAdSession(T0), 12);
  const sponsorContext = (state: AdSessionState, seriesId = "series_a") => ({
    ...boundary(state),
    seriesId,
    atSeriesStart: true,
  });

  it("is capped at 3 seconds", () => {
    expect(evaluateSponsorCard(ready, sponsorContext(ready))).toEqual({
      allowed: true,
      maxDurationMs: 3_000,
      startMuted: false,
    });
  });

  it("respects the grace like any interruption", () => {
    const early = watch(createAdSession(T0), 2);
    expect(evaluateSponsorCard(early, sponsorContext(early))).toEqual({
      allowed: false,
      reason: "session_grace",
    });
  });

  it("only appears when a series starts", () => {
    expect(
      evaluateSponsorCard(ready, { ...sponsorContext(ready), atSeriesStart: false }),
    ).toEqual({
      allowed: false,
      reason: "not_series_start",
    });
  });

  it("appears once per series per session", () => {
    const shown = recordInterruption(
      ready,
      { kind: "sponsor_card", durationMs: 3_000, seriesId: "series_a" },
      ready.lastWatchedAtMs,
    );
    const later = watch(shown, 20);
    expect(evaluateSponsorCard(later, sponsorContext(later, "series_a"))).toEqual({
      allowed: false,
      reason: "sponsor_already_shown_for_series",
    });
    expect(evaluateSponsorCard(later, sponsorContext(later, "series_b"))).toMatchObject({
      allowed: true,
    });
  });

  it("shares spacing with ad breaks: no card right after a break", () => {
    const afterBreak = watch(adBreak(ready), 5);
    expect(evaluateSponsorCard(afterBreak, sponsorContext(afterBreak))).toEqual({
      allowed: false,
      reason: "too_soon_after_last_interruption",
    });
  });

  it("fits exactly when 3 s of hourly budget are left, and not when none is", () => {
    const withBreaks = (durationMs: number) => {
      let state = createAdSession(T0);
      for (let i = 0; i < 6; i += 1) {
        state = adBreak(watch(state, 10), durationMs);
      }
      return watch(state, 10);
    };
    // 6 × 29.5 s = 177 s used in the window: the 3 s card still fits.
    const tight = withBreaks(29_500);
    expect(evaluateSponsorCard(tight, sponsorContext(tight))).toEqual({
      allowed: true,
      maxDurationMs: 3_000,
      startMuted: false,
    });
    // 6 × 30 s = 180 s used: nothing fits.
    const full = withBreaks(30_000);
    expect(evaluateSponsorCard(full, sponsorContext(full))).toEqual({
      allowed: false,
      reason: "hourly_cap_reached",
    });
  });

  it("counts toward the hourly cap of later ad breaks", () => {
    let state = createAdSession(T0);
    for (let i = 0; i < 5; i += 1) {
      state = adBreak(watch(state, 10));
    }
    state = recordInterruption(
      watch(state, 10),
      { kind: "sponsor_card", durationMs: 3_000, seriesId: "series_a" },
      state.lastWatchedAtMs + 10 * MIN,
    );
    // Window at minute 70 holds breaks at 10–50 (150 s) and the card at 60 (3 s).
    const next = watch(state, 10);
    expect(evaluateAdBreak(next, boundary(next))).toEqual({
      allowed: true,
      maxDurationMs: 27_000,
      startMuted: false,
    });
  });
});
