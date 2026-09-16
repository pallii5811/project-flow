/** Consumer-facing feed copy helpers (no technical episode codes). */

export function formatEpisodeLabel(episodeNumber: number): string | null {
  if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) return null;
  return `Episode ${Math.floor(episodeNumber)}`;
}
