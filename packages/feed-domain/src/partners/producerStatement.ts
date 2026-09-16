/**
 * Monthly producer statement for one market (docs/business-model.md).
 *
 * The producer pool is a share of the market's revenue; it is split across
 * series pro-rata to verified watched time. All money is integer cents and
 * the split uses the largest-remainder method, so the lines always add up to
 * the pool and pool + platform always add up to the revenue — to the cent.
 *
 * What is unknown stays unknown: revenue not yet reported produces minutes
 * with null amounts, never zero amounts.
 */

export type ProducerStatementInput = {
  /** Calendar month, e.g. "2026-10". */
  period: string;
  /** Country code the revenue belongs to. */
  market: string;
  /** Net revenue for the market and month in cents; null while not reported. */
  revenueCents: number | null;
  /** Producer share in basis points: 5000 = 50%. */
  producerShareBps: number;
  watchedMsBySeries: Readonly<Record<string, number>>;
  /** Producer of record per series. */
  producerBySeries: Readonly<Record<string, string>>;
};

export type ProducerStatementLine = {
  seriesId: string;
  /** null = no producer of record: the amount is owed but nobody can be paid. */
  producerId: string | null;
  watchedMs: number;
  watchedMinutes: number;
  producerShareCents: number | null;
};

export type ProducerStatementIssue =
  | { kind: "invalid_revenue" }
  | { kind: "invalid_share" }
  | { kind: "invalid_watched_ms"; seriesId: string }
  | { kind: "series_without_producer"; seriesId: string }
  | { kind: "revenue_without_watch_time" };

export type ProducerStatement = {
  period: string;
  market: string;
  producerShareBps: number;
  /** null when any series reported an unreadable watched time. */
  totalWatchedMs: number | null;
  revenueCents: number | null;
  producerPoolCents: number | null;
  platformCents: number | null;
  lines: ProducerStatementLine[];
  issues: ProducerStatementIssue[];
};

function toMinutes(ms: number): number {
  return Math.round(ms / 600) / 100;
}

// BigInt(…) instead of 0n literals: apps/web type-checks this package at ES2017.
const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_TWO = BigInt(2);
const BIG_BPS = BigInt(10_000);

/** round(value × bps / 10 000), half up, exact for any safe-integer revenue. */
function shareOf(valueCents: number, bps: number): number {
  const numerator = BigInt(valueCents) * BigInt(bps);
  return Number((numerator * BIG_TWO + BIG_BPS) / (BIG_BPS * BIG_TWO));
}

/** Splits `total` cents pro-rata to `weights`; ties go to the lower series id. */
function allocateLargestRemainder(
  total: number,
  weights: ReadonlyArray<{ seriesId: string; weight: number }>,
): Map<string, number> {
  const totalWeight = weights.reduce(
    (sum, entry) => sum + BigInt(entry.weight),
    BIG_ZERO,
  );
  const allocation = new Map<string, number>();
  if (totalWeight === BIG_ZERO) return allocation;

  const bigTotal = BigInt(total);
  const shares = weights.map((entry) => {
    const numerator = bigTotal * BigInt(entry.weight);
    return {
      seriesId: entry.seriesId,
      floor: numerator / totalWeight,
      remainder: numerator % totalWeight,
    };
  });

  let assigned = shares.reduce((sum, share) => sum + share.floor, BIG_ZERO);
  const byRemainder = [...shares].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.seriesId.localeCompare(b.seriesId);
  });
  const extra = new Set<string>();
  for (const share of byRemainder) {
    if (assigned >= bigTotal) break;
    extra.add(share.seriesId);
    assigned += BIG_ONE;
  }

  for (const share of shares) {
    allocation.set(
      share.seriesId,
      Number(share.floor + (extra.has(share.seriesId) ? BIG_ONE : BIG_ZERO)),
    );
  }
  return allocation;
}

export function buildProducerStatement(input: ProducerStatementInput): ProducerStatement {
  const issues: ProducerStatementIssue[] = [];

  const revenueValid =
    input.revenueCents === null ||
    (Number.isSafeInteger(input.revenueCents) && input.revenueCents >= 0);
  if (!revenueValid) issues.push({ kind: "invalid_revenue" });

  const shareValid =
    Number.isInteger(input.producerShareBps) &&
    input.producerShareBps >= 0 &&
    input.producerShareBps <= 10_000;
  if (!shareValid) issues.push({ kind: "invalid_share" });

  const seriesIds = Object.keys(input.watchedMsBySeries).sort((a, b) =>
    a.localeCompare(b),
  );
  let watchValid = true;
  let totalWatchedMs = 0;
  for (const seriesId of seriesIds) {
    const ms = input.watchedMsBySeries[seriesId];
    if (ms === undefined || !Number.isSafeInteger(ms) || ms < 0) {
      watchValid = false;
      issues.push({ kind: "invalid_watched_ms", seriesId });
      continue;
    }
    totalWatchedMs += ms;
    if (!input.producerBySeries[seriesId]) {
      issues.push({ kind: "series_without_producer", seriesId });
    }
  }

  const revenueCents = revenueValid ? input.revenueCents : null;
  const canPrice = revenueCents !== null && shareValid && watchValid;
  const producerPoolCents = canPrice
    ? shareOf(revenueCents, input.producerShareBps)
    : null;
  const platformCents =
    canPrice && producerPoolCents !== null ? revenueCents - producerPoolCents : null;

  if (producerPoolCents !== null && producerPoolCents > 0 && totalWatchedMs === 0) {
    issues.push({ kind: "revenue_without_watch_time" });
  }

  const allocation =
    producerPoolCents === null
      ? null
      : allocateLargestRemainder(
          producerPoolCents,
          seriesIds.map((seriesId) => ({
            seriesId,
            weight: input.watchedMsBySeries[seriesId] ?? 0,
          })),
        );

  const lines: ProducerStatementLine[] = watchValid
    ? seriesIds.map((seriesId) => {
        const watchedMs = input.watchedMsBySeries[seriesId] ?? 0;
        return {
          seriesId,
          producerId: input.producerBySeries[seriesId] ?? null,
          watchedMs,
          watchedMinutes: toMinutes(watchedMs),
          producerShareCents: allocation ? (allocation.get(seriesId) ?? 0) : null,
        };
      })
    : [];

  return {
    period: input.period,
    market: input.market,
    producerShareBps: input.producerShareBps,
    totalWatchedMs: watchValid ? totalWatchedMs : null,
    revenueCents,
    producerPoolCents,
    platformCents,
    lines,
    issues,
  };
}
