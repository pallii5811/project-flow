/**
 * Optional ranking blend for Scene Graph signals.
 * Kept separate from Recommendation V0 core so the flag can stay OFF.
 */
import type { SceneGraphSignals } from "../model/types";

/** Explicit small constants — not ML. */
export const SCENE_SIGNAL_BLEND = {
  genre: 0.04,
  trope: 0.03,
  emotional: 0.02,
  narrative: 0.02,
  character: 0.01,
} as const;

export function blendSceneGraphSignals(
  baseScore: number,
  signals: SceneGraphSignals | null | undefined,
  enabled: boolean,
): number {
  if (!enabled || !signals) return baseScore;
  return (
    baseScore +
    SCENE_SIGNAL_BLEND.genre * signals.genreMatch +
    SCENE_SIGNAL_BLEND.trope * signals.tropeMatch +
    SCENE_SIGNAL_BLEND.emotional * signals.emotionalMatch +
    SCENE_SIGNAL_BLEND.narrative * signals.narrativePatternMatch +
    SCENE_SIGNAL_BLEND.character * signals.characterPatternMatch
  );
}
