import AsyncStorage from "@react-native-async-storage/async-storage";

import { createEmptyProfile } from "./tasteProfile";
import type { UserTasteProfile } from "../model/types";

const STORAGE_KEY = "project-flow.taste.v1";

export type TasteProfileStore = {
  load(): Promise<UserTasteProfile>;
  save(profile: UserTasteProfile): Promise<void>;
};

export function createMemoryTasteStore(
  initial: UserTasteProfile = createEmptyProfile(),
): TasteProfileStore {
  let value = initial;
  return {
    async load() {
      return value;
    },
    async save(profile) {
      value = profile;
    },
  };
}

export function createAsyncTasteStore(): TasteProfileStore {
  if (typeof AsyncStorage?.getItem !== "function") {
    return createMemoryTasteStore();
  }
  return {
    async load() {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return createEmptyProfile();
      try {
        const parsed = JSON.parse(raw) as UserTasteProfile;
        if (parsed.version !== 1) return createEmptyProfile();
        return parsed;
      } catch {
        return createEmptyProfile();
      }
    },
    async save(profile) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    },
  };
}
