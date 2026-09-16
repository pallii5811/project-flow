import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  createMemoryResumeStore,
  type ResumeSnapshot,
  type ResumeStore,
} from "./resumeStore";

const STORAGE_KEY = "project-flow.resume.v1";

export function createAsyncResumeStore(): ResumeStore {
  // Fallback for non-RN test environments if native module is missing.
  if (typeof AsyncStorage?.getItem !== "function") {
    return createMemoryResumeStore();
  }

  return {
    async load() {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as ResumeSnapshot;
        if (
          typeof parsed.contentId !== "string" ||
          typeof parsed.positionMs !== "number"
        ) {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },
    async save(snapshot) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    },
    async clear() {
      await AsyncStorage.removeItem(STORAGE_KEY);
    },
  };
}
