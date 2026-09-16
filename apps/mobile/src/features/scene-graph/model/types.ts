import type {
  CharacterRole,
  EmotionalDirection,
  EmotionalTone,
  MetadataSource,
  NarrativeBeat,
  RelationshipType,
  SceneGenre,
  SceneTrope,
} from "./taxonomy";
import { SCHEMA_VERSION } from "./taxonomy";

export type Intensity = number; // 0–1

export type SceneCharacter = {
  id: string;
  canonicalName: string;
  role: CharacterRole;
  aliases?: string[];
};

export type SceneRelationship = {
  id: string;
  fromCharacterId: string;
  toCharacterId: string;
  type: RelationshipType;
  status?: string;
};

export type SceneNode = {
  id: string;
  seriesId: string;
  episodeId: string;
  sequence: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  title?: string;
  label?: string;
  characterIds: string[];
  characterRoles?: CharacterRole[];
  relationshipIds?: string[];
  setting?: string;
  timeContext?: string;
  genres: SceneGenre[];
  tropes: SceneTrope[];
  emotionalTone?: EmotionalTone;
  emotionalIntensity?: Intensity;
  emotionalDirection?: EmotionalDirection;
  conflict?: string;
  narrativeBeat?: NarrativeBeat;
  cliffhangerStrength?: Intensity;
  importance?: Intensity;
  dialogueDensity?: Intensity;
  actionDensity?: Intensity;
  romanceIntensity?: Intensity;
  suspenseIntensity?: Intensity;
  comedyIntensity?: Intensity;
  /** Promotional / hook heuristics — fixture/manual in V0, not ML. */
  hookStrength?: Intensity;
  emotionalPeak?: Intensity;
  surpriseStrength?: Intensity;
  schemaVersion: typeof SCHEMA_VERSION;
  metadataVersion: number;
  metadataConfidence: Intensity;
  source: MetadataSource;
  createdAt: number;
  updatedAt: number;
};

export type SceneEpisodeNode = {
  id: string;
  seriesId: string;
  episodeNumber: number;
  title: string;
  durationMs: number;
  sceneIds: string[];
};

export type SceneSeriesNode = {
  id: string;
  title: string;
  episodeIds: string[];
  characterIds: string[];
};

/**
 * Document-style Scene Graph document — not a graph database.
 * Series → Episodes → Scenes (+ Characters, Relationships).
 */
export type SceneGraphDocument = {
  schemaVersion: typeof SCHEMA_VERSION;
  metadataVersion: number;
  series: SceneSeriesNode[];
  episodes: SceneEpisodeNode[];
  scenes: SceneNode[];
  characters: SceneCharacter[];
  relationships: SceneRelationship[];
};

export type SceneQuery = {
  seriesId?: string;
  episodeId?: string;
  genres?: SceneGenre[];
  tropes?: SceneTrope[];
  characterIds?: string[];
  characterRoles?: CharacterRole[];
  emotionalTone?: EmotionalTone;
  narrativeBeat?: NarrativeBeat;
  minCliffhangerStrength?: Intensity;
  minRomanceIntensity?: Intensity;
  minSuspenseIntensity?: Intensity;
  minEmotionalIntensity?: Intensity;
  minHookStrength?: Intensity;
  minConfidence?: Intensity;
};

export type SceneResult = {
  scene: SceneNode;
  matchedFields: string[];
  confidenceSummary: {
    metadataConfidence: Intensity;
    source: MetadataSource;
  };
};

export type EpisodeAggregation = {
  episodeId: string;
  seriesId: string;
  episodeGenres: SceneGenre[];
  episodeTropes: SceneTrope[];
  episodeEmotionalIntensity: Intensity;
  episodeCliffhangerStrength: Intensity;
  episodeHookStrength: Intensity;
  dominantTone?: EmotionalTone;
  sceneCount: number;
};

export type SeriesAggregation = {
  seriesId: string;
  dominantGenres: SceneGenre[];
  dominantTropes: SceneTrope[];
  characterSet: string[];
  overallTone?: EmotionalTone;
  maxCliffhangerStrength: Intensity;
  sceneCount: number;
  episodeCount: number;
};

/** Optional future ranking signals — Recommendation V0 works without these. */
export type SceneGraphSignals = {
  genreMatch: number;
  tropeMatch: number;
  emotionalMatch: number;
  narrativePatternMatch: number;
  characterPatternMatch: number;
};
