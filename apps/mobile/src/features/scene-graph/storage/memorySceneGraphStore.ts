import type { SceneGraphDocument, SceneNode } from "../model/types";

export type SceneGraphStore = {
  load(): Promise<SceneGraphDocument | null>;
  save(doc: SceneGraphDocument): Promise<void>;
  getScenesByEpisode(episodeId: string): Promise<SceneNode[]>;
  getScenesBySeries(seriesId: string): Promise<SceneNode[]>;
  getScene(sceneId: string): Promise<SceneNode | null>;
  isAvailable(): Promise<boolean>;
};

export function createMemorySceneGraphStore(
  initial: SceneGraphDocument | null = null,
): SceneGraphStore {
  let doc = initial;
  return {
    async load() {
      return doc;
    },
    async save(next) {
      doc = next;
    },
    async getScenesByEpisode(episodeId) {
      if (!doc) return [];
      return doc.scenes
        .filter((s) => s.episodeId === episodeId)
        .sort((a, b) => a.sequence - b.sequence);
    },
    async getScenesBySeries(seriesId) {
      if (!doc) return [];
      return doc.scenes
        .filter((s) => s.seriesId === seriesId)
        .sort((a, b) => a.episodeId.localeCompare(b.episodeId) || a.sequence - b.sequence);
    },
    async getScene(sceneId) {
      if (!doc) return null;
      return doc.scenes.find((s) => s.id === sceneId) ?? null;
    },
    async isAvailable() {
      return doc !== null;
    },
  };
}

/** Simulates unavailable storage for hostile tests. */
export function createUnavailableSceneGraphStore(): SceneGraphStore {
  return {
    async load() {
      return null;
    },
    async save() {
      throw new Error("Scene Graph storage unavailable");
    },
    async getScenesByEpisode() {
      return [];
    },
    async getScenesBySeries() {
      return [];
    },
    async getScene() {
      return null;
    },
    async isAvailable() {
      return false;
    },
  };
}
