/**
 * When a series is really over (MP-7). `series_complete` feeds
 * series_completion_rate and time_to_next_series (docs/content-strategy.md),
 * so it must mean one thing: the viewer finished the series' last episode.
 * An episode whose successor is missing, not ready or not published yet is a
 * different event, `series_unavailable_next`.
 */

/** Watched fraction from which leaving an episode counts as finishing it. */
export const SERIES_FINISHED_FRACTION = 0.95;

export type SeriesEndKind = "series_complete" | "series_unavailable_next";

export function isLastEpisode(episodeNumber: number, totalEpisodes: number | null): boolean {
  return totalEpisodes !== null && totalEpisodes > 0 && episodeNumber >= totalEpisodes;
}

/** The episode ended and no next episode could be placed: which of the two it is. */
export function classifySeriesEnd(
  episodeNumber: number,
  totalEpisodes: number | null,
): SeriesEndKind {
  return isLastEpisode(episodeNumber, totalEpisodes)
    ? "series_complete"
    : "series_unavailable_next";
}

/** A viewer leaving the last episode (swipe) after watching nearly all of it. */
export function finishedLastEpisode(
  episodeNumber: number,
  totalEpisodes: number | null,
  watchedFraction: number,
): boolean {
  return (
    isLastEpisode(episodeNumber, totalEpisodes) && watchedFraction >= SERIES_FINISHED_FRACTION
  );
}
