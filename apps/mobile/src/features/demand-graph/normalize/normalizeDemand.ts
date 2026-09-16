import type {
  SceneGenre,
  SceneTrope,
} from "../../scene-graph/model/taxonomy";
import {
  isEmotionalTone,
  isSceneGenre,
  isSceneTrope,
} from "../../scene-graph/model/taxonomy";
import type { IntentModel } from "../../intent/model/types";
import type { DemandGapKind, NormalizedDemandPattern } from "../model/types";
import { DEFAULT_DEMAND_THRESHOLDS } from "../model/thresholds";

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function intensityBucket(
  delta: number | undefined,
  romanceMin: number | undefined,
  suspenseMin: number | undefined,
): NormalizedDemandPattern["emotionalIntensityBucket"] | undefined {
  const peak = Math.max(delta ?? 0, romanceMin ?? 0, suspenseMin ?? 0);
  if (peak <= 0) return undefined;
  if (peak < 0.35) return "low";
  if (peak < 0.65) return "mid";
  return "high";
}

/**
 * Normalize structured intent → controlled demand dimensions.
 * Does NOT invent unsupported fields; unresolved stay listed.
 */
export function normalizeFromIntent(intent: IntentModel): NormalizedDemandPattern {
  const genres = uniqueSorted(
    (intent.genres ?? []).filter(isSceneGenre),
  ) as SceneGenre[];
  const tropes = uniqueSorted(
    (intent.tropes ?? []).filter(isSceneTrope),
  ) as SceneTrope[];
  const unresolvedFields = [...intent.unresolvedTerms];

  const characterRoles: string[] = [];
  if (intent.preferProtagonist) characterRoles.push("protagonist");
  if (intent.preferFemaleLead) {
    characterRoles.push("female_lead_soft");
    if (!unresolvedFields.includes("female_lead_metadata_unavailable")) {
      unresolvedFields.push("female_lead_metadata_unavailable");
    }
  }

  let gapKindHint: DemandGapKind = "NO_GAP";
  if (intent.parserSource === "unresolved" || intent.confidence < 0.35) {
    gapKindHint = "INTENT_GAP";
  } else if (
    genres.length + tropes.length > 0 ||
    intent.emotionalTone ||
    intent.preferFemaleLead
  ) {
    gapKindHint = "CONTENT_GAP";
  }

  const tone =
    intent.emotionalTone && isEmotionalTone(intent.emotionalTone)
      ? intent.emotionalTone
      : undefined;

  return {
    genres,
    tropes,
    ...(tone ? { emotionalTone: tone } : {}),
    ...(intensityBucket(
      intent.emotionalIntensityDelta,
      intent.romanceIntensityMin,
      intent.suspenseIntensityMin,
    )
      ? {
          emotionalIntensityBucket: intensityBucket(
            intent.emotionalIntensityDelta,
            intent.romanceIntensityMin,
            intent.suspenseIntensityMin,
          ),
        }
      : {}),
    ...(characterRoles.length ? { characterRoles: uniqueSorted(characterRoles) } : {}),
    ...(intent.language ? { language: intent.language } : {}),
    ...(intent.preferFemaleLead ? { preferFemaleLead: true } : {}),
    ...(intent.surprise ? { surprise: true } : {}),
    unresolvedFields: uniqueSorted(unresolvedFields),
    gapKindHint,
  };
}

/**
 * Deterministic canonical key. Equivalent patterns → same key.
 * Format: v{version}|g:...|t:...|tone:...|int:...|roles:...|lang:...|flags:...
 */
export function buildCanonicalKey(
  pattern: NormalizedDemandPattern,
  keyVersion = DEFAULT_DEMAND_THRESHOLDS.keyVersion,
): string {
  const parts = [
    `v${keyVersion}`,
    `g:${pattern.genres.join(",") || "-"}`,
    `t:${pattern.tropes.join(",") || "-"}`,
    `tone:${pattern.emotionalTone ?? "-"}`,
    `int:${pattern.emotionalIntensityBucket ?? "-"}`,
    `roles:${(pattern.characterRoles ?? []).join(",") || "-"}`,
    `rel:${(pattern.relationshipPatterns ?? []).join(",") || "-"}`,
    `set:${pattern.setting ?? "-"}`,
    `lang:${pattern.language ?? "-"}`,
    `flags:${[
      pattern.preferFemaleLead ? "fl" : "",
      pattern.surprise ? "sur" : "",
    ]
      .filter(Boolean)
      .join(",") || "-"}`,
  ];
  return parts.join("|");
}

export function patternIdFromKey(canonicalKey: string): string {
  let h = 2166136261;
  for (let i = 0; i < canonicalKey.length; i += 1) {
    h ^= canonicalKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `dp_${(h >>> 0).toString(36)}`;
}

/** Overlap-based relatedness between two normalized patterns. */
export function patternsRelated(
  a: NormalizedDemandPattern,
  b: NormalizedDemandPattern,
): boolean {
  const genreOverlap = a.genres.some((g) => b.genres.includes(g));
  const tropeOverlap = a.tropes.some((t) => b.tropes.includes(t));
  const roleOverlap = (a.characterRoles ?? []).some((r) =>
    (b.characterRoles ?? []).includes(r),
  );
  const toneSame =
    a.emotionalTone && b.emotionalTone && a.emotionalTone === b.emotionalTone;
  return (
    (genreOverlap && tropeOverlap) ||
    (genreOverlap && roleOverlap) ||
    (tropeOverlap && Boolean(toneSame))
  );
}

export function emptyBehavioralEvidence(): import("../model/types").BehavioralEvidence {
  return {
    uniqueUsers: 0,
    requestCount: 0,
    repeatUsers: 0,
    cappedRequestCount: 0,
    relatedContentImpressions: 0,
    relatedContentPlays: 0,
    relatedContentCompletions: 0,
    relatedContentSkips: 0,
    relatedContentWatchTimeMs: 0,
    relatedContentNextItem: 0,
    shares: 0,
    follows: 0,
    returns: 0,
    relatedPlayRate: 0,
    relatedCompletionRate: 0,
    relatedNextItemRate: 0,
  };
}
