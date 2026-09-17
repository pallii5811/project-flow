import {
  RESUME_SERIES_CAP,
  createMemoryResumeStore,
  sortResumeEntries,
  upsertResumeEntry,
  type ResumeSnapshot,
  type ResumeStore,
} from "./resumeStore";

/** One entry per series (VIR-2). */
export const RESUME_STORAGE_KEY = "project-flow.resume.v2";
/** The single snapshot written before resume points were kept per series. */
export const LEGACY_RESUME_STORAGE_KEY = "project-flow.resume.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function localStorageOrNull(): StorageLike | null {
  try {
    const storage = globalThis.localStorage;
    return typeof storage?.getItem === "function" ? storage : null;
  } catch {
    return null;
  }
}

export function isResumeSnapshot(value: unknown): value is ResumeSnapshot {
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

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Reads both formats: the per-series list and, until it is rewritten, the old
 * single snapshot. Invalid rows are dropped, never the whole list.
 */
export function readResumeEntries(v2Raw: string | null, v1Raw: string | null): ResumeSnapshot[] {
  const parsed = parseJson(v2Raw);
  const rows =
    typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { entries?: unknown }).entries)
      ? ((parsed as { entries: unknown[] }).entries)
      : [];
  let entries = sortResumeEntries(rows.filter(isResumeSnapshot));
  const legacy = parseJson(v1Raw);
  if (isResumeSnapshot(legacy)) {
    const known = entries.find((entry) => entry.seriesId === legacy.seriesId);
    if (!known || known.updatedAt < legacy.updatedAt) {
      entries = upsertResumeEntry(entries, legacy);
    }
  }
  return entries.slice(0, RESUME_SERIES_CAP);
}

/** Web resume store backed by `localStorage` (falls back to memory when unavailable). */
export function createLocalStorageResumeStore(
  storage: StorageLike | null = localStorageOrNull(),
): ResumeStore {
  if (!storage) {
    return createMemoryResumeStore();
  }

  const readAll = (): ResumeSnapshot[] => {
    try {
      return readResumeEntries(
        storage.getItem(RESUME_STORAGE_KEY),
        storage.getItem(LEGACY_RESUME_STORAGE_KEY),
      );
    } catch {
      return [];
    }
  };

  return {
    async load() {
      return readAll()[0] ?? null;
    },
    async loadForSeries(seriesId) {
      return readAll().find((entry) => entry.seriesId === seriesId) ?? null;
    },
    async loadAll() {
      return readAll();
    },
    async save(snapshot) {
      const entries = upsertResumeEntry(readAll(), snapshot);
      try {
        storage.setItem(RESUME_STORAGE_KEY, JSON.stringify({ version: 2, entries }));
        // Migrated into the list: the old key would otherwise shadow newer points.
        storage.removeItem(LEGACY_RESUME_STORAGE_KEY);
      } catch {
        // Full or blocked storage: resume is a convenience, never an error.
      }
    },
    async clear() {
      try {
        storage.removeItem(RESUME_STORAGE_KEY);
        storage.removeItem(LEGACY_RESUME_STORAGE_KEY);
      } catch {
        // nothing to clear
      }
    },
  };
}
