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

export type Series = {
  id: string;
  seriesSlug: string;
  title: string;
  status: ContentStatus;
  coverUrl: string;
  totalEpisodes: number;
  defaultLocale: string;
  localizedMetadata: LocalizedMetadata;
};

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
