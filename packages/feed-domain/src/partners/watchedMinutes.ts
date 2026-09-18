/**
 * Watched minutes per series — the unit producers are paid on
 * (docs/business-model.md, "Producers").
 *
 * Input is the stream of `watch_progress` heartbeats. A heartbeat carries a
 * POSITION, not a duration, so watched time is rebuilt from consecutive
 * heartbeats of the same session and episode:
 *
 *   watched += min(position advance, wall-clock advance + jitter tolerance)
 *
 * - a seek forward earns only the wall time that really passed;
 * - a pause (same position) earns nothing, however long;
 * - a rewind or replay earns nothing until playback advances again;
 * - the first heartbeat of an episode earns nothing: its position may come
 *   from a resume, and crediting it would pay for minutes nobody watched.
 *
 * Money depends on this number, so nothing is guessed: a heartbeat with an
 * unreadable field is rejected and counted, never coerced to zero.
 */
import type { AnalyticsEnvelope } from "@project-flow/analytics";

/** Heartbeat timestamps and positions are sampled at different instants. */
export const WATCH_SAMPLE_JITTER_TOLERANCE_MS = 500;

export type WatchProgressRecord = {
  eventId: string;
  sessionId: string;
  contentId: string;
  seriesId: string;
  /** Country the collector saw the request from; null when unknown. */
  market: string | null;
  timestampMs: number;
  positionMs: number;
  durationMs: number | null;
};

export type WatchedMinutesRow = {
  seriesId: string;
  market: string | null;
  /** Calendar month in UTC, e.g. "2026-10". A statement is always one month. */
  period: string;
  watchedMs: number;
};

export type WatchedMinutesResult = {
  rows: WatchedMinutesRow[];
  /**
   * Every market and every month added together. Useful to see the size of
   * the whole, never to build a statement: paying a US statement on worldwide
   * minutes overpays the rich pool from emerging-market viewing (CP-5). Use
   * `watchedMsBySeriesFor` for anything that becomes money.
   */
  watchedMsBySeries: Record<string, number>;
  totalWatchedMs: number;
  counts: {
    received: number;
    used: number;
    duplicates: number;
  };
};

export type EnvelopeConversion = {
  records: WatchProgressRecord[];
  /** Envelopes that are not watch_progress at all. */
  ignored: number;
  /** watch_progress envelopes with a missing or unreadable field. */
  rejected: number;
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Reads heartbeats from collected envelopes; unreadable ones are counted, not guessed. */
export function watchProgressRecordsFromEnvelopes(
  envelopes: readonly AnalyticsEnvelope[],
): EnvelopeConversion {
  const records: WatchProgressRecord[] = [];
  let ignored = 0;
  let rejected = 0;

  for (const envelope of envelopes) {
    if (envelope.event_name !== "watch_progress") {
      ignored += 1;
      continue;
    }
    const properties = envelope.properties ?? {};
    const eventId = nonEmptyString(envelope.event_id);
    const sessionId = nonEmptyString(envelope.session_id);
    const contentId = nonEmptyString(envelope.content_id ?? properties.content_id);
    const seriesId = nonEmptyString(envelope.series_id ?? properties.series_id);
    const timestampMs = Date.parse(envelope.timestamp);
    const positionMs = finiteNonNegative(properties.position_ms);
    const rawDuration = properties.duration_ms;
    const durationMs = finiteNonNegative(rawDuration);

    const durationUnreadable =
      rawDuration !== undefined && rawDuration !== null && durationMs === null;
    if (
      !eventId ||
      !sessionId ||
      !contentId ||
      !seriesId ||
      !Number.isFinite(timestampMs) ||
      positionMs === null ||
      durationUnreadable
    ) {
      rejected += 1;
      continue;
    }

    records.push({
      eventId,
      sessionId,
      contentId,
      seriesId,
      market: nonEmptyString(envelope.country),
      timestampMs,
      positionMs,
      durationMs: durationMs !== null && durationMs > 0 ? durationMs : null,
    });
  }

  return { records, ignored, rejected };
}

/** UTC month of an instant: the month a statement is issued for. */
export function periodOf(timestampMs: number): string {
  const date = new Date(timestampMs);
  const month = date.getUTCMonth() + 1;
  return `${date.getUTCFullYear()}-${month < 10 ? "0" : ""}${month}`;
}

function clampPosition(record: WatchProgressRecord): number {
  return record.durationMs === null
    ? record.positionMs
    : Math.min(record.positionMs, record.durationMs);
}

export function computeWatchedMinutes(
  records: readonly WatchProgressRecord[],
): WatchedMinutesResult {
  const seen = new Set<string>();
  const groups = new Map<string, WatchProgressRecord[]>();
  let duplicates = 0;

  for (const record of records) {
    if (seen.has(record.eventId)) {
      duplicates += 1;
      continue;
    }
    seen.add(record.eventId);
    // JSON keys cannot collide the way "a" + "bc" and "ab" + "c" would.
    const key = JSON.stringify([record.sessionId, record.contentId]);
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  const byRow = new Map<string, WatchedMinutesRow>();

  for (const group of groups.values()) {
    group.sort((a, b) => a.timestampMs - b.timestampMs || a.positionMs - b.positionMs);
    for (let i = 1; i < group.length; i += 1) {
      const previous = group[i - 1];
      const current = group[i];
      if (!previous || !current) continue;
      const mediaAdvance = clampPosition(current) - clampPosition(previous);
      if (mediaAdvance <= 0) continue;
      const wallAdvance = Math.max(0, current.timestampMs - previous.timestampMs);
      const earned = Math.min(
        mediaAdvance,
        wallAdvance + WATCH_SAMPLE_JITTER_TOLERANCE_MS,
      );

      const period = periodOf(current.timestampMs);
      const rowKey = JSON.stringify([current.seriesId, current.market, period]);
      const row = byRow.get(rowKey);
      if (row) row.watchedMs += earned;
      else
        byRow.set(rowKey, {
          seriesId: current.seriesId,
          market: current.market,
          period,
          watchedMs: earned,
        });
    }
  }

  const rows = [...byRow.values()].sort(
    (a, b) =>
      a.seriesId.localeCompare(b.seriesId) ||
      (a.market ?? "").localeCompare(b.market ?? "") ||
      a.period.localeCompare(b.period),
  );
  const watchedMsBySeries: Record<string, number> = {};
  let totalWatchedMs = 0;
  for (const row of rows) {
    watchedMsBySeries[row.seriesId] =
      (watchedMsBySeries[row.seriesId] ?? 0) + row.watchedMs;
    totalWatchedMs += row.watchedMs;
  }

  return {
    rows,
    watchedMsBySeries,
    totalWatchedMs,
    counts: { received: records.length, used: records.length - duplicates, duplicates },
  };
}

export type MarketPeriodSelection = {
  /** Country code the revenue belongs to. */
  market: string;
  /** Calendar month in UTC, e.g. "2026-10". */
  period: string;
};

export type MarketPeriodWatchTime = {
  /** Minutes of this market and month only — what a statement may be built on. */
  watchedMsBySeries: Record<string, number>;
  /**
   * Watch time of the same month that reached us without a country. It belongs
   * to some market; we do not know which, so it is never added to this one and
   * the statement declares it instead.
   */
  unattributedMs: number;
  rowsUsed: number;
};

/**
 * The minutes of ONE market and ONE month (CP-5).
 *
 * `watchedMsBySeries` on the full result mixes every market and month; feeding
 * it to `buildProducerStatement`, which takes a single market, would pay a US
 * pool for minutes watched anywhere. This is the only shape a statement
 * should see.
 */
export function watchedMsBySeriesFor(
  result: WatchedMinutesResult,
  selection: MarketPeriodSelection,
): MarketPeriodWatchTime {
  const watchedMsBySeries: Record<string, number> = {};
  let unattributedMs = 0;
  let rowsUsed = 0;
  for (const row of result.rows) {
    if (row.period !== selection.period) continue;
    if (row.market === null) {
      unattributedMs += row.watchedMs;
      continue;
    }
    if (row.market !== selection.market) continue;
    watchedMsBySeries[row.seriesId] =
      (watchedMsBySeries[row.seriesId] ?? 0) + row.watchedMs;
    rowsUsed += 1;
  }
  return { watchedMsBySeries, unattributedMs, rowsUsed };
}
