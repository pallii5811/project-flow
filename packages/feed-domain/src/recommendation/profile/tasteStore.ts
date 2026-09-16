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

/** Browser localStorage taste store; falls back to memory when unavailable. */
export function createLocalStorageTasteStore(): TasteProfileStore {
  if (typeof localStorage === "undefined") {
    return createMemoryTasteStore();
  }
  return {
    async load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return createEmptyProfile();
        const parsed = JSON.parse(raw) as UserTasteProfile;
        if (parsed.version !== 1) return createEmptyProfile();
        return parsed;
      } catch {
        return createEmptyProfile();
      }
    },
    async save(profile) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
      } catch {
        // quota / private mode — ignore
      }
    },
  };
}

/** @deprecated Prefer createLocalStorageTasteStore on web / createMemoryTasteStore in tests. */
export function createAsyncTasteStore(): TasteProfileStore {
  return createLocalStorageTasteStore();
}
