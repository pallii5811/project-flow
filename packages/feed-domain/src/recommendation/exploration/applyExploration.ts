import type { ContentItem } from "../../model/types";
import { averageAffinity } from "../profile/tasteProfile";
import { EXPLORATION_EVERY_N } from "../model/weights";
import type {
  RecommendationCandidate,
  UserTasteProfile,
} from "../model/types";

/** Deterministic seeded [0,1) PRNG (mulberry32). */
export function seededUnit(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Occasionally inject an exploration candidate outside top affinity genres.
 */
export function applyExploration(
  ranked: RecommendationCandidate[],
  catalog: ContentItem[],
  profile: UserTasteProfile,
  opts: { enabled: boolean; seed: number },
): RecommendationCandidate[] {
  if (!opts.enabled || ranked.length < 3) return ranked;

  const rand = seededUnit(opts.seed);
  const topGenres = Object.entries(profile.likedGenres)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([g]) => g);

  // A set, not ranked.some per catalog item: that was candidates × catalog.
  const continuationIds = new Set(
    ranked.filter((c) => c.source === "continuation").map((c) => c.contentId),
  );
  const outside = catalog.filter((item) => {
    if (continuationIds.has(item.id)) {
      return false;
    }
    if (topGenres.length === 0) return true;
    return !item.genres.some((g) => topGenres.includes(g));
  });

  if (outside.length === 0) return ranked;

  const pickIndex = Math.floor(rand() * outside.length);
  const picked = outside[pickIndex];
  if (!picked) return ranked;

  const exploration: RecommendationCandidate = {
    contentId: picked.id,
    seriesId: picked.seriesId,
    source: "exploration",
    reasons: ["exploration"],
    score: averageAffinity(profile.likedGenres, picked.genres),
  };

  const out = ranked.filter((c) => c.contentId !== exploration.contentId);
  // Insert at exploration slot (every N), skipping index 0 if continuation owns it.
  let slot = EXPLORATION_EVERY_N - 1;
  if (out[0]?.source === "continuation") slot += 1;
  slot = Math.min(slot, out.length);
  out.splice(slot, 0, exploration);
  return out;
}
