import type { ContentItem } from "../../feed/model/types";
import type { ClosestContentRef, NormalizedDemandPattern } from "../model/types";

function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let hits = 0;
  for (const v of a) if (b.includes(v)) hits += 1;
  return hits / Math.max(a.length, b.length);
}

/**
 * Closest available catalog item for a demand pattern.
 * Prevents false conclusions from zero-result queries alone.
 */
export function findClosestContent(
  pattern: NormalizedDemandPattern,
  catalog: ContentItem[],
): ClosestContentRef | null {
  if (catalog.length === 0) return null;

  let best: ClosestContentRef | null = null;

  for (const item of catalog) {
    const matchedFields: string[] = [];
    let score = 0;

    const g = overlap(pattern.genres, item.genres);
    if (g > 0) {
      score += g * 0.45;
      matchedFields.push("genres");
    }
    const t = overlap(pattern.tropes, item.tropes);
    if (t > 0) {
      score += t * 0.4;
      matchedFields.push("tropes");
    }
    if (pattern.emotionalTone === "dark") {
      if (
        item.genres.includes("thriller") ||
        item.tropes.includes("revenge") ||
        item.tropes.includes("betrayal")
      ) {
        score += 0.15;
        matchedFields.push("tone_proxy");
      }
    }
    if (pattern.preferFemaleLead || pattern.characterRoles?.includes("protagonist")) {
      if (item.genres.includes("romance") || item.genres.includes("drama")) {
        score += 0.1;
        matchedFields.push("lead_proxy");
      }
    }
    if (pattern.language && item.language === pattern.language) {
      score += 0.05;
      matchedFields.push("language");
    }

    if (!best || score > best.overlapScore) {
      best = {
        contentId: item.id,
        seriesId: item.seriesId,
        overlapScore: score,
        matchedFields,
      };
    }
  }

  if (!best || best.overlapScore <= 0) return null;
  return best;
}
