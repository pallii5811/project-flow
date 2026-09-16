import type {
  EmotionalTone,
  SceneGenre,
  SceneTrope,
} from "../model/taxonomy";
import type {
  EpisodeAggregation,
  Intensity,
  SceneGraphDocument,
  SceneNode,
  SeriesAggregation,
} from "../model/types";

function uniquePreserve<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function maxIntensity(scenes: SceneNode[], field: keyof SceneNode): Intensity {
  let max = 0;
  for (const scene of scenes) {
    const value = scene[field];
    if (typeof value === "number" && value > max) max = value;
  }
  return max;
}

/**
 * Episode emotional intensity = max scene intensity (peaks matter more than averages).
 * Cliffhanger = last scene cliffhanger if present, else max.
 * Genres/tropes = union in scene order (transparent, not averaged).
 */
export function aggregateEpisode(
  doc: SceneGraphDocument,
  episodeId: string,
): EpisodeAggregation | null {
  const episode = doc.episodes.find((e) => e.id === episodeId);
  if (!episode) return null;
  const scenes = doc.scenes
    .filter((s) => s.episodeId === episodeId)
    .sort((a, b) => a.sequence - b.sequence);

  const genres = uniquePreserve(scenes.flatMap((s) => s.genres)) as SceneGenre[];
  const tropes = uniquePreserve(scenes.flatMap((s) => s.tropes)) as SceneTrope[];
  const last = scenes[scenes.length - 1];
  const toneCounts = new Map<EmotionalTone, number>();
  for (const scene of scenes) {
    if (!scene.emotionalTone) continue;
    toneCounts.set(
      scene.emotionalTone,
      (toneCounts.get(scene.emotionalTone) ?? 0) + 1,
    );
  }
  let dominantTone: EmotionalTone | undefined;
  let best = 0;
  for (const [tone, count] of toneCounts) {
    if (count > best) {
      best = count;
      dominantTone = tone;
    }
  }

  return {
    episodeId,
    seriesId: episode.seriesId,
    episodeGenres: genres,
    episodeTropes: tropes,
    episodeEmotionalIntensity: maxIntensity(scenes, "emotionalIntensity"),
    episodeCliffhangerStrength:
      last?.cliffhangerStrength ?? maxIntensity(scenes, "cliffhangerStrength"),
    episodeHookStrength: maxIntensity(scenes, "hookStrength"),
    ...(dominantTone ? { dominantTone } : {}),
    sceneCount: scenes.length,
  };
}

/**
 * Series aggregation:
 * - dominant genres/tropes = top by scene frequency (not naive average)
 * - overallTone = mode across scenes
 * - characterSet = series.characterIds
 * - maxCliffhanger = max across scenes
 */
export function aggregateSeries(
  doc: SceneGraphDocument,
  seriesId: string,
): SeriesAggregation | null {
  const series = doc.series.find((s) => s.id === seriesId);
  if (!series) return null;
  const scenes = doc.scenes.filter((s) => s.seriesId === seriesId);
  const episodes = doc.episodes.filter((e) => e.seriesId === seriesId);

  const genreCounts = new Map<SceneGenre, number>();
  const tropeCounts = new Map<SceneTrope, number>();
  const toneCounts = new Map<EmotionalTone, number>();

  for (const scene of scenes) {
    for (const g of scene.genres) {
      genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
    }
    for (const t of scene.tropes) {
      tropeCounts.set(t, (tropeCounts.get(t) ?? 0) + 1);
    }
    if (scene.emotionalTone) {
      toneCounts.set(
        scene.emotionalTone,
        (toneCounts.get(scene.emotionalTone) ?? 0) + 1,
      );
    }
  }

  const sortTop = <T>(map: Map<T, number>, limit: number): T[] =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .slice(0, limit)
      .map(([k]) => k);

  let overallTone: EmotionalTone | undefined;
  let best = 0;
  for (const [tone, count] of toneCounts) {
    if (count > best) {
      best = count;
      overallTone = tone;
    }
  }

  return {
    seriesId,
    dominantGenres: sortTop(genreCounts, 3),
    dominantTropes: sortTop(tropeCounts, 5),
    characterSet: [...series.characterIds],
    ...(overallTone ? { overallTone } : {}),
    maxCliffhangerStrength: maxIntensity(scenes, "cliffhangerStrength"),
    sceneCount: scenes.length,
    episodeCount: episodes.length,
  };
}
