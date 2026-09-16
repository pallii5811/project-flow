import type {
  BehavioralEvidence,
  DemandPatternRecord,
  ProductionSignal,
} from "../model/types";
import { trendDirection } from "../aggregate/deriveState";

const DISCLAIMER =
  "Confidence reflects evidence volume, not predicted viewers or guaranteed audience. Correlation is not causation.";

export function buildProductionSignal(
  pattern: DemandPatternRecord,
): ProductionSignal | null {
  if (
    pattern.state !== "BEHAVIORALLY_VALIDATED" &&
    pattern.state !== "PRODUCTION_SIGNAL"
  ) {
    return null;
  }
  if (pattern.gapKind !== "CONTENT_GAP") {
    return null;
  }

  const countries = Object.entries(pattern.segments.byCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c]) => c);
  const languages = Object.entries(pattern.segments.byLanguage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([l]) => l);

  const decayed = pattern.activityScore * 0.9;
  return {
    demandPatternId: pattern.patternId,
    canonicalKey: pattern.canonicalKey,
    demandPattern: pattern.normalized,
    targetMarkets: { countries, languages },
    dominantTropes: pattern.normalized.tropes.slice(0, 5),
    ...(pattern.normalized.emotionalTone
      ? { desiredTone: pattern.normalized.emotionalTone }
      : {}),
    ...(pattern.normalized.characterRoles?.[0]
      ? { protagonistPattern: pattern.normalized.characterRoles[0] }
      : {}),
    ...(pattern.normalized.relationshipPatterns?.[0]
      ? { relationshipPattern: pattern.normalized.relationshipPatterns[0] }
      : {}),
    closestContent: pattern.closestContent,
    evidenceSummary: { ...pattern.evidence },
    confidenceLevel: pattern.confidenceLevel,
    confidenceNote: confidenceNote(pattern.evidence, pattern.confidenceLevel),
    firstSeen: pattern.firstSeen,
    lastSeen: pattern.lastSeen,
    trendDirection: trendDirection(pattern.activityScore, decayed),
    state: pattern.state === "PRODUCTION_SIGNAL" ? pattern.state : "BEHAVIORALLY_VALIDATED",
    disclaimer: DISCLAIMER,
  };
}

function confidenceNote(
  evidence: BehavioralEvidence,
  level: string,
): string {
  return `${level} confidence demand signal based on ${evidence.uniqueUsers} unique users and ${evidence.relatedContentCompletions} completed related views (capped per-user requests). Not a forecast.`;
}
