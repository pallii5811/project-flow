/**
 * Launch content contract (L1).
 * Consumer feed only receives published, validated items.
 */

export type ContentStatus = "draft" | "published" | "unpublished" | "expired";

export type PlaybackProviderKind = "static" | "cdn" | "signed" | "hls";

export type PreloadHint = "none" | "metadata" | "auto";

/** Storage/provider-agnostic playback description — not a raw CDN leak into UI. */
export type PlaybackDescriptor = {
  provider: PlaybackProviderKind;
  /** Provider-relative reference (e.g. `/content/series/.../hls/episode-1/master.m3u8`). */
  reference: string;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
  /** width / height. Vertical drama prefers ≈ 9/16 (0.5625). */
  aspectRatio: number;
  /** Poster reference (same asset boundary as video). */
  posterReference: string;
  /**
   * Landscape 1200×630 card for link previews (VIR-4). Crawlers crop wide
   * cards to about 1.91:1, so the portrait poster loses the face and the
   * title; this image is generated from the same frame at ingest.
   */
  shareCardReference: string;
  /** ISO-8601; null = does not expire. */
  expiresAt: string | null;
  preloadHint: PreloadHint;
};

export type CaptionKind = "subtitles" | "captions";

export type CaptionTrackStatus = "ready" | "missing" | "failed";

export type CaptionTrack = {
  language: string;
  url: string;
  kind: CaptionKind;
  default: boolean;
  status: CaptionTrackStatus;
};

export type LocalizedStrings = {
  title: string;
  hook: string;
  description?: string;
};

/** Locale → copy. Fallback: requested → base language → defaultLocale. */
export type LocalizedMetadata = Record<string, LocalizedStrings>;

/**
 * Rights on paper, carried by the series itself (F8, docs/roadmap.md).
 *
 * The curation gate asks for territories, languages, window and producer of
 * record before a series enters the catalog; keeping them next to the series
 * is what lets the code refuse to list a title outside its window instead of
 * trusting a spreadsheet.
 */
export type SeriesRights = {
  /** ISO 3166-1 alpha-2 codes, or the single entry "WORLD". */
  territories: string[];
  /** Languages the licence covers (audio or subtitles), as BCP-47 tags. */
  languages: string[];
  /** ISO-8601; null = the window has always been open. */
  windowStart: string | null;
  /** ISO-8601; null = the window does not close. */
  windowEnd: string | null;
};

export type Series = {
  id: string;
  seriesSlug: string;
  title: string;
  status: ContentStatus;
  coverUrl: string;
  totalEpisodes: number;
  defaultLocale: string;
  localizedMetadata: LocalizedMetadata;
  /** Producer of record: who is paid and who answers for the rights (CP-6). */
  producerId: string;
  /** Social clips of this title are allowed only when the producer said so. */
  socialClipsAllowed: boolean;
  rights: SeriesRights;
};

/** Is the licence window open at `now`? An unreadable date is never open. */
export function isSeriesWindowOpen(rights: SeriesRights, now: number): boolean {
  if (rights.windowStart !== null) {
    const start = Date.parse(rights.windowStart);
    if (!Number.isFinite(start) || start > now) return false;
  }
  if (rights.windowEnd !== null) {
    const end = Date.parse(rights.windowEnd);
    if (!Number.isFinite(end) || end <= now) return false;
  }
  return true;
}

export type ContentItem = {
  id: string;
  seriesId: string;
  episodeId: string;
  episodeNumber: number;
  episodeSlug: string;
  status: ContentStatus;
  /** Resolved display title (default locale). */
  title: string;
  seriesTitle: string;
  hook: string;
  /** Resolved poster URL for UI (from playback.posterReference after resolve). */
  thumbnailUrl: string;
  /**
   * Resolved playable URL for feed helpers / materialize.
   * Prefer `playback` + VideoProvider for new code.
   */
  videoUrl: string;
  playback: PlaybackDescriptor;
  captions: CaptionTrack[];
  captionsAvailable: boolean;
  durationMs: number;
  language: string;
  defaultLocale: string;
  localizedMetadata: LocalizedMetadata;
  order: number;
  genres: string[];
  tropes: string[];
  editorialPriority: number;
  popularityScore: number;
};

export type FeedCatalog = {
  series: Series[];
  items: ContentItem[];
};

/** Prefer portrait ~9:16. Warn/reject when wider than this. */
export const VERTICAL_ASPECT_MAX = 0.65;
export const VERTICAL_ASPECT_MIN = 0.45;

export const ALLOWED_VIDEO_MIME = new Set([
  "video/mp4",
  "video/webm",
  "application/vnd.apple.mpegurl",
]);
