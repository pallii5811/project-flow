/**
 * The words on the series page, composed from numbers the catalog measured —
 * never a sentence with a blank in it (docs/standard.md, rule 5: a plausible
 * default is read out loud and the viewer is the one who finds the mistake).
 * Pure, so seriesCopy.test.ts can prove each one.
 */

export function episodeCountLine(count: number): string {
  return count === 1 ? "1 episode" : `${count} episodes`;
}

/**
 * How long the whole story runs, or null when it is under a minute — a
 * stand-in pack of ten-second episodes must not print "0 min".
 */
export function runtimeLine(totalDurationMs: number): string | null {
  if (!Number.isFinite(totalDurationMs) || totalDurationMs < 60_000) return null;
  const minutes = Math.round(totalDurationMs / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "0:10", "1:05", "12:30": the length of one episode, as a player writes it. */
export function episodeLength(durationMs: number): string | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const total = Math.round(durationMs / 1_000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export type ContinuePoint =
  | { kind: "resume"; episodeNumber: number }
  | { kind: "next"; episodeNumber: number };

/** "Continue episode 3" / "Next: episode 4". One button, one true sentence. */
export function continueLabel(point: ContinuePoint): string {
  return point.kind === "resume"
    ? `Continue episode ${point.episodeNumber}`
    : `Next: episode ${point.episodeNumber}`;
}

/**
 * Where the viewer is in this story, from the one resume point kept per
 * series (VIR-2) and the episodes that exist.
 *
 * An episode finished sends them to the one after it; an episode left in the
 * middle sends them back to it. A saved point for an episode this build does
 * not carry is not a point at all — null, and the page offers episode 1.
 */
export function continuePoint(
  saved: { contentId: string; completed: boolean } | null,
  episodes: readonly { contentId: string; episodeNumber: number }[],
): ContinuePoint | null {
  if (!saved) return null;
  const at = episodes.findIndex((episode) => episode.contentId === saved.contentId);
  if (at < 0) return null;
  const here = episodes[at];
  if (!here) return null;
  if (!saved.completed) return { kind: "resume", episodeNumber: here.episodeNumber };
  const next = episodes[at + 1];
  // The last episode, finished: there is nothing to continue to, and saying
  // "next" would be inventing an episode.
  return next ? { kind: "next", episodeNumber: next.episodeNumber } : null;
}
