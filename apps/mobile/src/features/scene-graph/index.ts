export type {
  EpisodeAggregation,
  SceneCharacter,
  SceneGraphDocument,
  SceneGraphSignals,
  SceneNode,
  SceneQuery,
  SceneRelationship,
  SceneResult,
  SeriesAggregation,
} from "./model/types";
export {
  CHARACTER_ROLES,
  EMOTIONAL_TONES,
  NARRATIVE_BEATS,
  RELATIONSHIP_TYPES,
  SCENE_GENRES,
  SCENE_TROPES,
  SCHEMA_VERSION,
} from "./model/taxonomy";
export { validateSceneGraph } from "./validation/validateSceneGraph";
export { ingestSceneGraphDocument } from "./ingestion/ingestSceneGraph";
export { queryScenes, getFollowingScene } from "./query/queryScenes";
export { aggregateEpisode, aggregateSeries } from "./aggregation/aggregate";
export { createMockSceneGraphDocument } from "./fixtures/mockSceneGraph";
export {
  createMemorySceneGraphStore,
  createUnavailableSceneGraphStore,
} from "./storage/memorySceneGraphStore";
export {
  createSceneGraphService,
  createTestSceneGraphService,
  type SceneGraphService,
} from "./service/createSceneGraphService";
export { computeSceneGraphSignals } from "./signals/sceneGraphSignals";
export { blendSceneGraphSignals, SCENE_SIGNAL_BLEND } from "./signals/blendSignals";
