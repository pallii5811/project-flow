import {
  createMemoryResumeStore,
  type ResumeSnapshot,
  type ResumeStore,
} from "./resumeStore";

const STORAGE_KEY = "project-flow.resume.v1";

function hasLocalStorage(): boolean {
  try {
    return typeof globalThis.localStorage?.getItem === "function";
  } catch {
    return false;
  }
}

function isResumeSnapshot(value: unknown): value is ResumeSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.contentId === "string" &&
    typeof row.seriesId === "string" &&
    typeof row.episodeId === "string" &&
    typeof row.positionMs === "number" &&
    typeof row.durationMs === "number" &&
    typeof row.muted === "boolean" &&
    typeof row.captionsOn === "boolean" &&
    typeof row.updatedAt === "number" &&
    typeof row.completed === "boolean"
  );
}

/** Web resume store backed by `localStorage` (falls back to memory when unavailable). */
export function createLocalStorageResumeStore(): ResumeStore {
  if (!hasLocalStorage()) {
    return createMemoryResumeStore();
  }

  return {
    async load() {
      const raw = globalThis.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isResumeSnapshot(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    async save(snapshot) {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    },
    async clear() {
      globalThis.localStorage.removeItem(STORAGE_KEY);
    },
  };
}
