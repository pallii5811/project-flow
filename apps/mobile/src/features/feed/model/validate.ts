import type { ContentItem, FeedCatalog, Series } from "./types";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function parseSeries(raw: unknown): Series {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid series: expected object");
  }
  const row = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(row.id) ||
    !isNonEmptyString(row.title) ||
    !isNonEmptyString(row.coverUrl) ||
    !isPositiveInt(row.totalEpisodes)
  ) {
    throw new Error("Invalid series: missing required fields");
  }
  return {
    id: row.id,
    title: row.title,
    coverUrl: row.coverUrl,
    totalEpisodes: row.totalEpisodes,
  };
}

export function parseContentItem(raw: unknown): ContentItem {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid content item: expected object");
  }
  const row = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(row.id) ||
    !isNonEmptyString(row.seriesId) ||
    !isNonEmptyString(row.episodeId) ||
    !isPositiveInt(row.episodeNumber) ||
    !isNonEmptyString(row.title) ||
    !isNonEmptyString(row.seriesTitle) ||
    !isNonEmptyString(row.hook) ||
    !isNonEmptyString(row.thumbnailUrl) ||
    !isNonEmptyString(row.videoUrl) ||
    !isPositiveInt(row.durationMs) ||
    !isNonEmptyString(row.language) ||
    typeof row.captionsAvailable !== "boolean" ||
    typeof row.order !== "number" ||
    !Number.isFinite(row.order) ||
    !isStringArray(row.genres) ||
    !isStringArray(row.tropes) ||
    typeof row.editorialPriority !== "number" ||
    typeof row.popularityScore !== "number"
  ) {
    throw new Error(`Invalid content item: malformed fields (${String(row.id)})`);
  }

  return {
    id: row.id,
    seriesId: row.seriesId,
    episodeId: row.episodeId,
    episodeNumber: row.episodeNumber,
    title: row.title,
    seriesTitle: row.seriesTitle,
    hook: row.hook,
    thumbnailUrl: row.thumbnailUrl,
    videoUrl: row.videoUrl,
    durationMs: row.durationMs,
    language: row.language,
    captionsAvailable: row.captionsAvailable,
    ...(isNonEmptyString(row.captionText) ? { captionText: row.captionText } : {}),
    order: row.order,
    genres: row.genres,
    tropes: row.tropes,
    editorialPriority: row.editorialPriority,
    popularityScore: row.popularityScore,
  };
}

export function parseCatalog(raw: unknown): FeedCatalog {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid catalog: expected object");
  }
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.series) || !Array.isArray(row.items)) {
    throw new Error("Invalid catalog: series/items must be arrays");
  }
  const series = row.series.map(parseSeries);
  const items = row.items.map(parseContentItem);
  if (items.length === 0) {
    throw new Error("Invalid catalog: items must not be empty");
  }
  const seriesIds = new Set(series.map((s) => s.id));
  for (const item of items) {
    if (!seriesIds.has(item.seriesId)) {
      throw new Error(`Content ${item.id} references unknown series ${item.seriesId}`);
    }
  }
  return { series, items };
}
