import type {
  CaptionTrack,
  ContentItem,
  ContentStatus,
  FeedCatalog,
  LocalizedMetadata,
  LocalizedStrings,
  PlaybackDescriptor,
  PreloadHint,
  Series,
} from "./types";
import {
  ALLOWED_VIDEO_MIME,
  VERTICAL_ASPECT_MAX,
  VERTICAL_ASPECT_MIN,
} from "./types";

export type ValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type CatalogValidationResult =
  | { ok: true; catalog: FeedCatalog }
  | { ok: false; issues: ValidationIssue[] };

const STATUSES = new Set<ContentStatus>([
  "draft",
  "published",
  "unpublished",
  "expired",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

function parseStatus(raw: unknown, path: string, issues: ValidationIssue[]): ContentStatus | null {
  if (typeof raw !== "string" || !STATUSES.has(raw as ContentStatus)) {
    issues.push(issue("invalid_status", path, `Expected ContentStatus, got ${String(raw)}`));
    return null;
  }
  return raw as ContentStatus;
}

function parseLocalized(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): LocalizedMetadata {
  if (typeof raw !== "object" || raw === null) {
    issues.push(issue("invalid_localized", path, "localizedMetadata must be an object"));
    return {};
  }
  const out: LocalizedMetadata = {};
  for (const [locale, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) {
      issues.push(issue("invalid_localized_entry", `${path}.${locale}`, "Expected object"));
      continue;
    }
    const row = value as Record<string, unknown>;
    if (!isNonEmptyString(row.title) || !isNonEmptyString(row.hook)) {
      issues.push(
        issue("invalid_localized_entry", `${path}.${locale}`, "title and hook required"),
      );
      continue;
    }
    const entry: LocalizedStrings = { title: row.title, hook: row.hook };
    if (isNonEmptyString(row.description)) entry.description = row.description;
    out[locale] = entry;
  }
  return out;
}

function parsePlayback(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): PlaybackDescriptor | null {
  if (typeof raw !== "object" || raw === null) {
    issues.push(issue("missing_playback", path, "playback descriptor required"));
    return null;
  }
  const row = raw as Record<string, unknown>;
  const provider = row.provider;
  if (
    provider !== "static" &&
    provider !== "cdn" &&
    provider !== "signed" &&
    provider !== "hls"
  ) {
    issues.push(issue("invalid_provider", `${path}.provider`, String(provider)));
    return null;
  }
  if (!isNonEmptyString(row.reference)) {
    issues.push(issue("missing_video", `${path}.reference`, "video reference required"));
    return null;
  }
  if (!isNonEmptyString(row.posterReference)) {
    issues.push(issue("missing_poster", `${path}.posterReference`, "poster required"));
    return null;
  }
  if (!isNonEmptyString(row.mimeType) || !ALLOWED_VIDEO_MIME.has(row.mimeType)) {
    issues.push(
      issue("invalid_mime", `${path}.mimeType`, `Unsupported MIME: ${String(row.mimeType)}`),
    );
    return null;
  }
  if (!isPositiveInt(row.durationMs)) {
    issues.push(issue("missing_duration", `${path}.durationMs`, "durationMs must be > 0"));
    return null;
  }
  if (!isPositiveInt(row.width) || !isPositiveInt(row.height)) {
    issues.push(issue("invalid_dimensions", `${path}.width/height`, "positive dimensions required"));
    return null;
  }
  const aspectRatio =
    isFiniteNumber(row.aspectRatio) && row.aspectRatio > 0
      ? row.aspectRatio
      : row.width / row.height;
  if (aspectRatio < VERTICAL_ASPECT_MIN || aspectRatio > VERTICAL_ASPECT_MAX) {
    issues.push(
      issue(
        "invalid_aspect_ratio",
        `${path}.aspectRatio`,
        `Expected vertical ~9:16 (${VERTICAL_ASPECT_MIN}–${VERTICAL_ASPECT_MAX}), got ${aspectRatio}`,
      ),
    );
    return null;
  }
  const preloadHint: PreloadHint =
    row.preloadHint === "none" || row.preloadHint === "metadata" || row.preloadHint === "auto"
      ? row.preloadHint
      : "metadata";
  const expiresAt =
    row.expiresAt === null || row.expiresAt === undefined
      ? null
      : isNonEmptyString(row.expiresAt)
        ? row.expiresAt
        : null;
  if (row.expiresAt !== null && row.expiresAt !== undefined && expiresAt === null) {
    issues.push(issue("invalid_expires", `${path}.expiresAt`, "expiresAt must be ISO string or null"));
    return null;
  }

  return {
    provider,
    reference: row.reference,
    mimeType: row.mimeType,
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    aspectRatio,
    posterReference: row.posterReference,
    expiresAt,
    preloadHint,
  };
}

function parseCaptions(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
  requireCaptions: boolean,
): CaptionTrack[] {
  if (!Array.isArray(raw)) {
    if (requireCaptions) {
      issues.push(issue("missing_captions", path, "captions array required for published items"));
    }
    return [];
  }
  const tracks: CaptionTrack[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    if (typeof entry !== "object" || entry === null) {
      issues.push(issue("invalid_caption", `${path}[${i}]`, "Expected caption track object"));
      continue;
    }
    const row = entry as Record<string, unknown>;
    if (
      !isNonEmptyString(row.language) ||
      !isNonEmptyString(row.url) ||
      (row.kind !== "subtitles" && row.kind !== "captions") ||
      typeof row.default !== "boolean" ||
      (row.status !== "ready" && row.status !== "missing" && row.status !== "failed")
    ) {
      issues.push(issue("invalid_caption", `${path}[${i}]`, "Malformed caption track"));
      continue;
    }
    tracks.push({
      language: row.language,
      url: row.url,
      kind: row.kind,
      default: row.default,
      status: row.status,
    });
  }
  if (requireCaptions && !tracks.some((t) => t.status === "ready")) {
    issues.push(issue("missing_captions", path, "At least one ready caption track required"));
  }
  return tracks;
}

export function parseSeries(raw: unknown, issues: ValidationIssue[] = []): Series {
  if (typeof raw !== "object" || raw === null) {
    issues.push(issue("invalid_series", "series", "Expected object"));
    throw new Error("Invalid series: expected object");
  }
  const row = raw as Record<string, unknown>;
  const status = parseStatus(row.status, `series.${String(row.id)}.status`, issues) ?? "draft";
  const localizedMetadata = parseLocalized(
    row.localizedMetadata ?? {},
    `series.${String(row.id)}.localizedMetadata`,
    issues,
  );
  if (
    !isNonEmptyString(row.id) ||
    !isNonEmptyString(row.title) ||
    !isNonEmptyString(row.seriesSlug) ||
    !isNonEmptyString(row.coverUrl) ||
    !isPositiveInt(row.totalEpisodes) ||
    !isNonEmptyString(row.defaultLocale)
  ) {
    issues.push(issue("invalid_series", `series.${String(row.id)}`, "Missing required fields"));
    throw new Error("Invalid series: missing required fields");
  }
  if (!localizedMetadata[row.defaultLocale]) {
    issues.push(
      issue(
        "missing_locale",
        `series.${row.id}.localizedMetadata`,
        `defaultLocale ${row.defaultLocale} missing`,
      ),
    );
  }
  return {
    id: row.id,
    title: row.title,
    seriesSlug: row.seriesSlug,
    coverUrl: row.coverUrl,
    totalEpisodes: row.totalEpisodes,
    status,
    defaultLocale: row.defaultLocale,
    localizedMetadata,
  };
}

export function parseContentItem(raw: unknown, issues: ValidationIssue[] = []): ContentItem {
  if (typeof raw !== "object" || raw === null) {
    issues.push(issue("invalid_item", "item", "Expected object"));
    throw new Error("Invalid content item: expected object");
  }
  const row = raw as Record<string, unknown>;
  const id = isNonEmptyString(row.id) ? row.id : "unknown";
  const status = parseStatus(row.status, `items.${id}.status`, issues) ?? "draft";
  const requireFullAssets = status === "published";
  const playback = parsePlayback(row.playback, `items.${id}.playback`, issues);
  const captions = parseCaptions(
    row.captions,
    `items.${id}.captions`,
    issues,
    requireFullAssets,
  );
  const localizedMetadata = parseLocalized(
    row.localizedMetadata ?? {},
    `items.${id}.localizedMetadata`,
    issues,
  );

  if (
    !isNonEmptyString(row.id) ||
    !isNonEmptyString(row.seriesId) ||
    !isNonEmptyString(row.episodeId) ||
    !isPositiveInt(row.episodeNumber) ||
    !isNonEmptyString(row.episodeSlug) ||
    !isNonEmptyString(row.title) ||
    !isNonEmptyString(row.seriesTitle) ||
    !isNonEmptyString(row.hook) ||
    !isNonEmptyString(row.thumbnailUrl) ||
    !isNonEmptyString(row.videoUrl) ||
    !isPositiveInt(row.durationMs) ||
    !isNonEmptyString(row.language) ||
    !isNonEmptyString(row.defaultLocale) ||
    typeof row.order !== "number" ||
    !Number.isFinite(row.order) ||
    !isStringArray(row.genres) ||
    !isStringArray(row.tropes) ||
    typeof row.editorialPriority !== "number" ||
    typeof row.popularityScore !== "number" ||
    !playback
  ) {
    issues.push(issue("invalid_item", `items.${id}`, "Malformed required fields"));
    throw new Error(`Invalid content item: malformed fields (${id})`);
  }

  if (requireFullAssets && !localizedMetadata[row.defaultLocale]) {
    issues.push(
      issue(
        "missing_locale",
        `items.${id}.localizedMetadata`,
        `defaultLocale ${row.defaultLocale} missing`,
      ),
    );
  }

  const captionsAvailable =
    typeof row.captionsAvailable === "boolean"
      ? row.captionsAvailable
      : captions.some((t) => t.status === "ready");

  return {
    id: row.id,
    seriesId: row.seriesId,
    episodeId: row.episodeId,
    episodeNumber: row.episodeNumber,
    episodeSlug: row.episodeSlug,
    status,
    title: row.title,
    seriesTitle: row.seriesTitle,
    hook: row.hook,
    thumbnailUrl: row.thumbnailUrl,
    videoUrl: row.videoUrl,
    playback,
    captions,
    captionsAvailable,
    durationMs: row.durationMs,
    language: row.language,
    defaultLocale: row.defaultLocale,
    localizedMetadata,
    order: row.order,
    genres: row.genres,
    tropes: row.tropes,
    editorialPriority: row.editorialPriority,
    popularityScore: row.popularityScore,
  };
}

/**
 * Full catalog parse + structural validation.
 * Throws on hard parse failures; use `validateCatalog` for structured results.
 */
export function parseCatalog(raw: unknown): FeedCatalog {
  const result = validateCatalog(raw);
  if (!result.ok) {
    throw new Error(
      `Invalid catalog: ${result.issues.map((i) => `${i.code}@${i.path}`).join("; ")}`,
    );
  }
  return result.catalog;
}

/** Deterministic structured validation — invalid content never enters consumer feed. */
export function validateCatalog(raw: unknown): CatalogValidationResult {
  const issues: ValidationIssue[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, issues: [issue("invalid_catalog", "catalog", "Expected object")] };
  }
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.series) || !Array.isArray(row.items)) {
    return {
      ok: false,
      issues: [issue("invalid_catalog", "catalog", "series/items must be arrays")],
    };
  }

  const series: Series[] = [];
  for (const entry of row.series) {
    try {
      series.push(parseSeries(entry, issues));
    } catch {
      // issues already recorded
    }
  }

  const items: ContentItem[] = [];
  for (const entry of row.items) {
    try {
      items.push(parseContentItem(entry, issues));
    } catch {
      // issues already recorded
    }
  }

  if (items.length === 0) {
    issues.push(issue("empty_catalog", "items", "items must not be empty"));
  }

  const seriesIds = new Set(series.map((s) => s.id));
  const seriesSlugs = new Set<string>();
  for (const s of series) {
    if (seriesSlugs.has(s.seriesSlug)) {
      issues.push(issue("duplicate_slug", `series.${s.id}`, `Duplicate seriesSlug ${s.seriesSlug}`));
    }
    seriesSlugs.add(s.seriesSlug);
  }

  const itemIds = new Set<string>();
  const episodeSlugKeys = new Set<string>();
  for (const item of items) {
    if (!seriesIds.has(item.seriesId)) {
      issues.push(
        issue("unknown_series", `items.${item.id}`, `Unknown series ${item.seriesId}`),
      );
    }
    if (itemIds.has(item.id)) {
      issues.push(issue("duplicate_id", `items.${item.id}`, "Duplicate content id"));
    }
    itemIds.add(item.id);
    const slugKey = `${item.seriesId}::${item.episodeSlug}`;
    if (episodeSlugKeys.has(slugKey)) {
      issues.push(
        issue("duplicate_slug", `items.${item.id}`, `Duplicate episodeSlug ${item.episodeSlug}`),
      );
    }
    episodeSlugKeys.add(slugKey);
  }

  // Next-episode consistency for published items. Indexed once: a lookup per
  // item over the whole list was quadratic (316 ms for 6,000 episodes).
  const firstByEpisode = new Map<string, Map<number, ContentItem>>();
  for (const item of items) {
    let series = firstByEpisode.get(item.seriesId);
    if (!series) {
      series = new Map();
      firstByEpisode.set(item.seriesId, series);
    }
    if (!series.has(item.episodeNumber)) series.set(item.episodeNumber, item);
  }
  for (const item of items) {
    if (item.status !== "published") continue;
    const next = firstByEpisode.get(item.seriesId)?.get(item.episodeNumber + 1);
    if (next && next.status !== "published" && next.status !== "draft") {
      // draft next is ok (end of published run); unpublished/expired mid-chain is a gap warning
      issues.push(
        issue(
          "next_episode_unavailable",
          `items.${item.id}`,
          `Next episode ${next.id} has status ${next.status}`,
        ),
      );
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, catalog: { series, items } };
}

/** Consumer feed catalog: published series + published, playable items only. */
export function toPublishedCatalog(catalog: FeedCatalog, now = Date.now()): FeedCatalog {
  const publishedSeries = catalog.series.filter((s) => s.status === "published");
  const seriesIds = new Set(publishedSeries.map((s) => s.id));
  const items = catalog.items.filter((item) => {
    if (item.status !== "published") return false;
    if (!seriesIds.has(item.seriesId)) return false;
    if (item.playback.expiresAt) {
      const expires = Date.parse(item.playback.expiresAt);
      if (Number.isFinite(expires) && expires <= now) return false;
    }
    if (!item.videoUrl.trim()) return false;
    return true;
  });
  return { series: publishedSeries, items };
}

export function isPlayableStatus(status: ContentStatus): boolean {
  return status === "published";
}
