import {
  emptyRetentionState,
  parseRetentionState,
  type RetentionState,
} from "./retentionState";

/** One document per device (retentionState.ts documents its shape). */
export const RETENTION_STORAGE_KEY = "project-flow.retention.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Follow and like, kept where the viewer left them.
 *
 * Synchronous on purpose: the follow state decides how a button is drawn, and
 * a promise there would draw it wrong for a frame on every open.
 */
export type RetentionStore = {
  load(): RetentionState;
  save(state: RetentionState): void;
  clear(): void;
};

/**
 * A private window, blocked site data, or a quota that is full: reading
 * `localStorage` can throw before it can be used. Playback never depends on
 * it, so every path here fails into memory instead of failing.
 */
function localStorageOrNull(): StorageLike | null {
  try {
    const storage = globalThis.localStorage;
    return typeof storage?.getItem === "function" ? storage : null;
  } catch {
    return null;
  }
}

export function createMemoryRetentionStore(): RetentionStore {
  let state = emptyRetentionState();
  return {
    load: () => state,
    save: (next) => {
      state = next;
    },
    clear: () => {
      state = emptyRetentionState();
    },
  };
}

export function createLocalStorageRetentionStore(
  storage: StorageLike | null = localStorageOrNull(),
): RetentionStore {
  if (!storage) return createMemoryRetentionStore();
  return {
    load() {
      let raw: string | null = null;
      try {
        raw = storage.getItem(RETENTION_STORAGE_KEY);
      } catch {
        return emptyRetentionState();
      }
      if (raw === null) return emptyRetentionState();
      try {
        return parseRetentionState(JSON.parse(raw) as unknown);
      } catch {
        // Not JSON any more: the viewer keeps watching, and the next save
        // writes a document that parses.
        return emptyRetentionState();
      }
    },
    save(state) {
      try {
        storage.setItem(RETENTION_STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Full or blocked storage: follow lasts for this page only, and
        // nothing on screen breaks.
      }
    },
    clear() {
      try {
        storage.removeItem(RETENTION_STORAGE_KEY);
      } catch {
        // nothing to clear
      }
    },
  };
}
