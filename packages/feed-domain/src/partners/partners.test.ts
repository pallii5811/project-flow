import type { AnalyticsEnvelope } from "@project-flow/analytics";
import { describe, expect, it } from "vitest";

import { buildProducerStatement, type ProducerStatementInput } from "./producerStatement";
import {
  computeWatchedMinutes,
  watchProgressRecordsFromEnvelopes,
  watchedMsBySeriesFor,
  type WatchProgressRecord,
} from "./watchedMinutes";

const T0 = Date.parse("2026-10-01T20:00:00.000Z");
let nextId = 0;

function beat(
  overrides: Partial<WatchProgressRecord> & { t: number; pos: number },
): WatchProgressRecord {
  nextId += 1;
  const { t, pos, ...rest } = overrides;
  return {
    eventId: `evt_${nextId}`,
    sessionId: "session_a",
    contentId: "item_1",
    seriesId: "series_a",
    market: "IT",
    timestampMs: T0 + t,
    positionMs: pos,
    durationMs: 60_000,
    ...rest,
  };
}

/** Uninterrupted playback: a heartbeat every 5 s from 0.25 s to the end. */
function continuousPlay(extra: Partial<WatchProgressRecord> = {}): WatchProgressRecord[] {
  const beats = [beat({ t: 250, pos: 250, ...extra })];
  for (let s = 5; s < 60; s += 5)
    beats.push(beat({ t: s * 1000, pos: s * 1000, ...extra }));
  beats.push(beat({ t: 60_000, pos: 60_000, ...extra }));
  return beats;
}

describe("computeWatchedMinutes", () => {
  it("rebuilds watched time from uninterrupted heartbeats (first beat earns nothing)", () => {
    const result = computeWatchedMinutes(continuousPlay());
    expect(result.totalWatchedMs).toBe(59_750);
    expect(result.watchedMsBySeries).toEqual({ series_a: 59_750 });
  });

  it("does not pay a resume position: resuming at 40 s credits only what follows", () => {
    const result = computeWatchedMinutes([
      beat({ t: 0, pos: 40_000 }),
      beat({ t: 5_000, pos: 45_000 }),
    ]);
    expect(result.totalWatchedMs).toBe(5_000);
  });

  it("pays a forward seek only for the wall time that passed", () => {
    const result = computeWatchedMinutes([
      beat({ t: 0, pos: 10_000 }),
      beat({ t: 5_000, pos: 50_000 }),
    ]);
    expect(result.totalWatchedMs).toBe(5_500);
  });

  it("pays nothing for a pause, however long", () => {
    const result = computeWatchedMinutes([
      beat({ t: 0, pos: 20_000 }),
      beat({ t: 600_000, pos: 20_000 }),
      beat({ t: 605_000, pos: 25_000 }),
    ]);
    expect(result.totalWatchedMs).toBe(5_000);
  });

  it("pays nothing for a rewind, then counts the replay as it advances", () => {
    const result = computeWatchedMinutes([
      beat({ t: 0, pos: 55_000 }),
      beat({ t: 5_000, pos: 60_000 }),
      beat({ t: 6_000, pos: 250 }),
      beat({ t: 11_000, pos: 5_250 }),
    ]);
    expect(result.totalWatchedMs).toBe(10_000);
  });

  it("never credits beyond the episode duration", () => {
    const result = computeWatchedMinutes([
      beat({ t: 0, pos: 58_000 }),
      beat({ t: 5_000, pos: 63_000 }),
    ]);
    expect(result.totalWatchedMs).toBe(2_000);
  });

  it("counts a retried batch once", () => {
    const beats = continuousPlay();
    const result = computeWatchedMinutes([...beats, ...beats]);
    expect(result.totalWatchedMs).toBe(59_750);
    expect(result.counts).toEqual({ received: 26, used: 13, duplicates: 13 });
  });

  it("is independent of arrival order", () => {
    const beats = continuousPlay();
    expect(computeWatchedMinutes([...beats].reverse()).totalWatchedMs).toBe(59_750);
  });

  it("adds separate sessions and splits by market", () => {
    const result = computeWatchedMinutes([
      ...continuousPlay(),
      ...continuousPlay({ sessionId: "session_b", market: "BR" }),
    ]);
    expect(result.rows).toEqual([
      { seriesId: "series_a", market: "BR", period: "2026-10", watchedMs: 59_750 },
      { seriesId: "series_a", market: "IT", period: "2026-10", watchedMs: 59_750 },
    ]);
    expect(result.totalWatchedMs).toBe(119_500);
  });

  it("keeps months apart: a statement is one month, in UTC", () => {
    const toNovember = Date.parse("2026-11-01T00:30:00.000Z") - T0;
    const result = computeWatchedMinutes([
      ...continuousPlay(),
      ...continuousPlay().map((record) => ({
        ...record,
        eventId: `${record.eventId}_nov`,
        sessionId: "session_nov",
        timestampMs: record.timestampMs + toNovember,
      })),
    ]);
    expect(result.rows.map((row) => row.period)).toEqual(["2026-10", "2026-11"]);
  });
});

describe("watchedMsBySeriesFor", () => {
  it("a single-market statement never sees another market's minutes", () => {
    const result = computeWatchedMinutes([
      ...continuousPlay(),
      ...continuousPlay({ sessionId: "session_b", market: "BR" }),
    ]);
    const italy = watchedMsBySeriesFor(result, { market: "IT", period: "2026-10" });
    expect(italy.watchedMsBySeries).toEqual({ series_a: 59_750 });
    expect(italy.unattributedMs).toBe(0);
    // The all-market total is exactly the trap this function exists to avoid.
    expect(result.watchedMsBySeries).toEqual({ series_a: 119_500 });
  });

  it("another month is not this month's revenue", () => {
    const result = computeWatchedMinutes(continuousPlay());
    expect(
      watchedMsBySeriesFor(result, { market: "IT", period: "2026-09" }).watchedMsBySeries,
    ).toEqual({});
  });

  it("minutes without a country are held apart, not given to this market", () => {
    const result = computeWatchedMinutes([
      ...continuousPlay(),
      ...continuousPlay({ sessionId: "session_c", market: null }),
    ]);
    const italy = watchedMsBySeriesFor(result, { market: "IT", period: "2026-10" });
    expect(italy.watchedMsBySeries).toEqual({ series_a: 59_750 });
    expect(italy.unattributedMs).toBe(59_750);
  });
});

describe("watchProgressRecordsFromEnvelopes", () => {
  function envelope(overrides: Partial<AnalyticsEnvelope> = {}): AnalyticsEnvelope {
    return {
      event_id: "evt_env_1",
      event_name: "watch_progress",
      timestamp: "2026-10-01T20:00:05.000Z",
      anonymous_user_id: "anon_1",
      session_id: "session_a",
      content_id: "item_1",
      series_id: "series_a",
      country: "IT",
      properties: { position_ms: 5_000, duration_ms: 60_000 },
      ...overrides,
    };
  }

  it("reads a well-formed heartbeat", () => {
    expect(watchProgressRecordsFromEnvelopes([envelope()])).toEqual({
      records: [
        {
          eventId: "evt_env_1",
          sessionId: "session_a",
          contentId: "item_1",
          seriesId: "series_a",
          market: "IT",
          timestampMs: Date.parse("2026-10-01T20:00:05.000Z"),
          positionMs: 5_000,
          durationMs: 60_000,
        },
      ],
      ignored: 0,
      rejected: 0,
    });
  });

  it("rejects unreadable heartbeats instead of reading them as zero", () => {
    const conversion = watchProgressRecordsFromEnvelopes([
      envelope({ properties: { position_ms: "5000", duration_ms: 60_000 } }),
      envelope({ properties: { duration_ms: 60_000 } }),
      envelope({ series_id: null, properties: { position_ms: 5_000 } }),
      envelope({ timestamp: "not a date" }),
      envelope({ properties: { position_ms: 5_000, duration_ms: "60000" } }),
    ]);
    expect(conversion).toEqual({ records: [], ignored: 0, rejected: 5 });
  });

  it("ignores other events and keeps an unknown market unknown", () => {
    const conversion = watchProgressRecordsFromEnvelopes([
      envelope({ event_name: "play" }),
      envelope({ country: null }),
    ]);
    expect(conversion.ignored).toBe(1);
    expect(conversion.records[0]?.market).toBeNull();
  });
});

describe("buildProducerStatement", () => {
  const base: ProducerStatementInput = {
    period: "2026-10",
    market: "IT",
    revenueCents: 40_000,
    producerShareBps: 5_000,
    watchedMsBySeries: { series_a: 60_000, series_b: 180_000 },
    producerBySeries: { series_a: "producer_x", series_b: "producer_y" },
  };

  it("splits the producer half pro-rata to watched time", () => {
    const statement = buildProducerStatement(base);
    expect(statement.producerPoolCents).toBe(20_000);
    expect(statement.platformCents).toBe(20_000);
    expect(statement.lines).toEqual([
      {
        seriesId: "series_a",
        producerId: "producer_x",
        watchedMs: 60_000,
        watchedMinutes: 1,
        producerShareCents: 5_000,
      },
      {
        seriesId: "series_b",
        producerId: "producer_y",
        watchedMs: 180_000,
        watchedMinutes: 3,
        producerShareCents: 15_000,
      },
    ]);
    expect(statement.issues).toEqual([]);
  });

  it("ties out to the cent when the split is not exact", () => {
    const statement = buildProducerStatement({
      ...base,
      revenueCents: 201,
      watchedMsBySeries: { series_a: 1, series_b: 1, series_c: 1 },
      producerBySeries: { series_a: "p", series_b: "p", series_c: "p" },
    });
    // 201 × 50% = 100.5 → 101 (half up, in the producers' favour); 101 / 3 = 33.67 each.
    expect(statement.producerPoolCents).toBe(101);
    expect(statement.platformCents).toBe(100);
    expect(statement.lines.map((line) => line.producerShareCents)).toEqual([34, 34, 33]);
    const lineSum = statement.lines.reduce(
      (sum, line) => sum + (line.producerShareCents ?? 0),
      0,
    );
    expect(lineSum).toBe(statement.producerPoolCents);
  });

  it("stays exact at sizes where floating point would drift", () => {
    const statement = buildProducerStatement({
      ...base,
      revenueCents: 9_007_199_254_740_991,
      producerShareBps: 3_333,
      watchedMsBySeries: { series_a: 7_000_000_000_001, series_b: 3 },
      producerBySeries: { series_a: "p", series_b: "p" },
    });
    const pool = statement.producerPoolCents ?? -1;
    const lineSum = statement.lines.reduce(
      (sum, line) => sum + (line.producerShareCents ?? 0),
      0,
    );
    expect(BigInt(pool) + BigInt(statement.platformCents ?? -1)).toBe(
      9_007_199_254_740_991n,
    );
    expect(lineSum).toBe(pool);
  });

  it("keeps unreported revenue unknown, not zero", () => {
    const statement = buildProducerStatement({ ...base, revenueCents: null });
    expect(statement.producerPoolCents).toBeNull();
    expect(statement.platformCents).toBeNull();
    expect(statement.lines.map((line) => line.producerShareCents)).toEqual([null, null]);
    expect(statement.lines.map((line) => line.watchedMinutes)).toEqual([1, 3]);
  });

  it("flags a series without a producer of record but still reserves its share", () => {
    const statement = buildProducerStatement({
      ...base,
      producerBySeries: { series_a: "producer_x" },
    });
    expect(statement.issues).toEqual([
      { kind: "series_without_producer", seriesId: "series_b" },
    ]);
    expect(statement.lines[1]).toMatchObject({
      producerId: null,
      producerShareCents: 15_000,
    });
  });

  it("flags revenue that no watched minute can carry", () => {
    const statement = buildProducerStatement({ ...base, watchedMsBySeries: {} });
    expect(statement.issues).toEqual([{ kind: "revenue_without_watch_time" }]);
    expect(statement.lines).toEqual([]);
  });

  it.each([
    [{ revenueCents: -1 }, "invalid_revenue"],
    [{ revenueCents: 10.5 }, "invalid_revenue"],
    [{ producerShareBps: 10_001 }, "invalid_share"],
    [{ producerShareBps: 50.5 }, "invalid_share"],
  ] as const)("refuses to price with %o", (override, kind) => {
    const statement = buildProducerStatement({ ...base, ...override });
    expect(statement.issues).toContainEqual({ kind });
    expect(statement.producerPoolCents).toBeNull();
    expect(statement.lines.every((line) => line.producerShareCents === null)).toBe(true);
  });

  it("refuses to price when a watched time is unreadable, and says which", () => {
    const statement = buildProducerStatement({
      ...base,
      watchedMsBySeries: { series_a: 60_000, series_b: Number.NaN },
    });
    expect(statement.issues).toEqual([
      { kind: "invalid_watched_ms", seriesId: "series_b" },
    ]);
    expect(statement.totalWatchedMs).toBeNull();
    expect(statement.producerPoolCents).toBeNull();
    expect(statement.revenueCents).toBe(40_000);
  });

  it("declares the minutes whose market the collector never saw", () => {
    const statement = buildProducerStatement({ ...base, unattributedWatchedMs: 12_000 });
    expect(statement.issues).toContainEqual({
      kind: "watch_time_without_market",
      watchedMs: 12_000,
    });
    // They are declared, never paid from this market's pool.
    expect(statement.totalWatchedMs).toBe(240_000);
    expect(statement.producerPoolCents).toBe(20_000);
  });
});
