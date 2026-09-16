/**
 * Ad Charter — the non-negotiable limits on interruptions (docs/standard.md §2).
 *
 * Pure and deterministic: callers report watched time and the interruptions
 * that actually ran; the charter answers whether one may start now and for how
 * long at most. It never decides WHAT to show — only whether showing anything
 * would break the promise made to the viewer.
 *
 * Changing a value requires a new entry in docs/decisions.md and a deliberate
 * change to adCharter.test.ts, which pins every number.
 */

export const AD_CHARTER = {
  /** Nothing interrupts the first 10 watched minutes of a session. */
  sessionGraceWatchedMs: 10 * 60_000,
  /** Watched time required between two interruptions of any kind. */
  minWatchedMsBetweenInterruptions: 10 * 60_000,
  /** Longest ad break. */
  maxAdBreakMs: 30_000,
  /** Longest sponsor card ("Presented by …"). */
  maxSponsorCardMs: 3_000,
  /** Ad time allowed in any window of `viewingHourMs` watched time. */
  maxAdMsPerViewingHour: 180_000,
  viewingHourMs: 60 * 60_000,
  /** A session ends after this long without watching. */
  sessionIdleResetMs: 30 * 60_000,
} as const;

export type AdInterruptionKind = "ad_break" | "sponsor_card";

export type AdLedgerEntry = {
  readonly kind: AdInterruptionKind;
  /** Session watched time at which the interruption started. */
  readonly atWatchedMs: number;
  /** How long it really ran — never the planned length. */
  readonly durationMs: number;
  readonly seriesId: string | null;
};

export type AdSessionState = {
  readonly lastWatchedAtMs: number;
  /** Watched content time in this session (ads excluded). */
  readonly watchedMs: number;
  readonly ledger: readonly AdLedgerEntry[];
};

export type AdPlacementContext = {
  nowMs: number;
  /** True only between two episodes — never inside one. */
  atEpisodeBoundary: boolean;
  /** Intent sheet, share sheet, series end or any other surface is open. */
  surfaceOpen: boolean;
  viewerMuted: boolean;
};

export type SponsorPlacementContext = AdPlacementContext & {
  seriesId: string;
  /** The next episode starts a series (episode 1, or a different series). */
  atSeriesStart: boolean;
};

export type AdDenialReason =
  | "surface_open"
  | "not_episode_boundary"
  | "not_series_start"
  | "session_grace"
  | "sponsor_already_shown_for_series"
  | "too_soon_after_last_interruption"
  | "hourly_cap_reached";

export type AdDecision =
  | {
      allowed: true;
      /** Upper bound; the ad layer may use less, never more. */
      maxDurationMs: number;
      /** A muted viewer is never unmuted by an interruption. */
      startMuted: boolean;
    }
  | { allowed: false; reason: AdDenialReason };

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function createAdSession(nowMs: number): AdSessionState {
  return { lastWatchedAtMs: nowMs, watchedMs: 0, ledger: [] };
}

/** The session as it stands at `nowMs`: an idle session has already ended. */
function effectiveSession(state: AdSessionState, nowMs: number): AdSessionState {
  if (nowMs - state.lastWatchedAtMs >= AD_CHARTER.sessionIdleResetMs) {
    return createAdSession(nowMs);
  }
  return state;
}

/**
 * Adds watched content time. Invalid deltas (negative, NaN, infinite) are
 * ignored rather than coerced: an unknown amount of watching is not zero
 * watching, and it must never unlock an interruption.
 */
export function recordWatchedTime(
  state: AdSessionState,
  deltaMs: number,
  nowMs: number,
): AdSessionState {
  if (!isNonNegativeFinite(deltaMs) || !Number.isFinite(nowMs)) return state;
  const session = effectiveSession(state, nowMs);
  return {
    lastWatchedAtMs: nowMs,
    watchedMs: session.watchedMs + deltaMs,
    ledger: session.ledger,
  };
}

/** Records an interruption that really ran, with its real duration. */
export function recordInterruption(
  state: AdSessionState,
  entry: { kind: AdInterruptionKind; durationMs: number; seriesId: string | null },
  nowMs: number,
): AdSessionState {
  if (!isNonNegativeFinite(entry.durationMs) || !Number.isFinite(nowMs)) return state;
  const session = effectiveSession(state, nowMs);
  return {
    lastWatchedAtMs: session.lastWatchedAtMs,
    watchedMs: session.watchedMs,
    ledger: [
      ...session.ledger,
      {
        kind: entry.kind,
        atWatchedMs: session.watchedMs,
        durationMs: entry.durationMs,
        seriesId: entry.seriesId,
      },
    ],
  };
}

/**
 * Ad time inside the rolling viewing hour. The window is inclusive at its
 * start: breaks at minutes 10, 20 … 70 would otherwise fit seven 30 s breaks
 * into one 60-minute window.
 */
function adMsInViewingHour(session: AdSessionState): number {
  const windowStart = session.watchedMs - AD_CHARTER.viewingHourMs;
  let total = 0;
  for (const entry of session.ledger) {
    if (entry.atWatchedMs >= windowStart) total += entry.durationMs;
  }
  return total;
}

function lastInterruption(session: AdSessionState): AdLedgerEntry | null {
  let last: AdLedgerEntry | null = null;
  for (const entry of session.ledger) {
    if (!last || entry.atWatchedMs >= last.atWatchedMs) last = entry;
  }
  return last;
}

/** Grace, spacing and hourly cap — shared by every kind of interruption. */
function evaluateCommonLimits(
  session: AdSessionState,
  maxForKindMs: number,
  viewerMuted: boolean,
): AdDecision {
  if (session.watchedMs < AD_CHARTER.sessionGraceWatchedMs) {
    return { allowed: false, reason: "session_grace" };
  }
  const last = lastInterruption(session);
  if (
    last &&
    session.watchedMs - last.atWatchedMs < AD_CHARTER.minWatchedMsBetweenInterruptions
  ) {
    return { allowed: false, reason: "too_soon_after_last_interruption" };
  }
  const remainingMs = AD_CHARTER.maxAdMsPerViewingHour - adMsInViewingHour(session);
  if (remainingMs <= 0) {
    return { allowed: false, reason: "hourly_cap_reached" };
  }
  return {
    allowed: true,
    maxDurationMs: Math.min(maxForKindMs, remainingMs),
    startMuted: viewerMuted,
  };
}

export function evaluateAdBreak(
  state: AdSessionState,
  context: AdPlacementContext,
): AdDecision {
  if (context.surfaceOpen) return { allowed: false, reason: "surface_open" };
  if (!context.atEpisodeBoundary)
    return { allowed: false, reason: "not_episode_boundary" };
  const session = effectiveSession(state, context.nowMs);
  return evaluateCommonLimits(session, AD_CHARTER.maxAdBreakMs, context.viewerMuted);
}

export function evaluateSponsorCard(
  state: AdSessionState,
  context: SponsorPlacementContext,
): AdDecision {
  if (context.surfaceOpen) return { allowed: false, reason: "surface_open" };
  if (!context.atEpisodeBoundary)
    return { allowed: false, reason: "not_episode_boundary" };
  if (!context.atSeriesStart) return { allowed: false, reason: "not_series_start" };
  const session = effectiveSession(state, context.nowMs);
  if (session.watchedMs < AD_CHARTER.sessionGraceWatchedMs) {
    return { allowed: false, reason: "session_grace" };
  }
  const alreadyShown = session.ledger.some(
    (entry) => entry.kind === "sponsor_card" && entry.seriesId === context.seriesId,
  );
  if (alreadyShown) return { allowed: false, reason: "sponsor_already_shown_for_series" };
  return evaluateCommonLimits(session, AD_CHARTER.maxSponsorCardMs, context.viewerMuted);
}
