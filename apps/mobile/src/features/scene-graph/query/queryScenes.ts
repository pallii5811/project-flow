import type {
  SceneGraphDocument,
  SceneNode,
  SceneQuery,
  SceneResult,
} from "../model/types";

function hasAll<T>(haystack: readonly T[], needles: readonly T[] | undefined): boolean {
  if (!needles || needles.length === 0) return true;
  return needles.every((n) => haystack.includes(n));
}

function matchScene(scene: SceneNode, query: SceneQuery): string[] | null {
  const matched: string[] = [];

  if (query.seriesId !== undefined) {
    if (scene.seriesId !== query.seriesId) return null;
    matched.push("seriesId");
  }
  if (query.episodeId !== undefined) {
    if (scene.episodeId !== query.episodeId) return null;
    matched.push("episodeId");
  }
  if (query.genres && query.genres.length > 0) {
    if (!hasAll(scene.genres, query.genres)) return null;
    matched.push("genres");
  }
  if (query.tropes && query.tropes.length > 0) {
    if (!hasAll(scene.tropes, query.tropes)) return null;
    matched.push("tropes");
  }
  if (query.characterIds && query.characterIds.length > 0) {
    if (!hasAll(scene.characterIds, query.characterIds)) return null;
    matched.push("characterIds");
  }
  if (query.characterRoles && query.characterRoles.length > 0) {
    const roles = scene.characterRoles ?? [];
    if (!hasAll(roles, query.characterRoles)) return null;
    matched.push("characterRoles");
  }
  if (query.emotionalTone !== undefined) {
    if (scene.emotionalTone !== query.emotionalTone) return null;
    matched.push("emotionalTone");
  }
  if (query.narrativeBeat !== undefined) {
    if (scene.narrativeBeat !== query.narrativeBeat) return null;
    matched.push("narrativeBeat");
  }
  if (query.minCliffhangerStrength !== undefined) {
    if ((scene.cliffhangerStrength ?? 0) < query.minCliffhangerStrength) return null;
    matched.push("cliffhangerStrength");
  }
  if (query.minRomanceIntensity !== undefined) {
    if ((scene.romanceIntensity ?? 0) < query.minRomanceIntensity) return null;
    matched.push("romanceIntensity");
  }
  if (query.minSuspenseIntensity !== undefined) {
    if ((scene.suspenseIntensity ?? 0) < query.minSuspenseIntensity) return null;
    matched.push("suspenseIntensity");
  }
  if (query.minEmotionalIntensity !== undefined) {
    if ((scene.emotionalIntensity ?? 0) < query.minEmotionalIntensity) return null;
    matched.push("emotionalIntensity");
  }
  if (query.minHookStrength !== undefined) {
    if ((scene.hookStrength ?? 0) < query.minHookStrength) return null;
    matched.push("hookStrength");
  }
  if (query.minConfidence !== undefined) {
    if (scene.metadataConfidence < query.minConfidence) return null;
    matched.push("metadataConfidence");
  }

  return matched;
}

/**
 * Typed compositional SceneQuery — AND semantics across provided fields.
 * Not a full query language.
 */
export function queryScenes(
  doc: SceneGraphDocument,
  query: SceneQuery,
): SceneResult[] {
  const results: SceneResult[] = [];
  for (const scene of doc.scenes) {
    const matchedFields = matchScene(scene, query);
    if (!matchedFields) continue;
    results.push({
      scene,
      matchedFields,
      confidenceSummary: {
        metadataConfidence: scene.metadataConfidence,
        source: scene.source,
      },
    });
  }
  return results.sort(
    (a, b) =>
      a.scene.seriesId.localeCompare(b.scene.seriesId) ||
      a.scene.episodeId.localeCompare(b.scene.episodeId) ||
      a.scene.sequence - b.scene.sequence,
  );
}

/** Sequence neighbor: scene N → follows → scene N+1 within same episode. */
export function getFollowingScene(
  doc: SceneGraphDocument,
  sceneId: string,
): SceneNode | null {
  const scene = doc.scenes.find((s) => s.id === sceneId);
  if (!scene) return null;
  return (
    doc.scenes.find(
      (s) =>
        s.episodeId === scene.episodeId && s.sequence === scene.sequence + 1,
    ) ?? null
  );
}
