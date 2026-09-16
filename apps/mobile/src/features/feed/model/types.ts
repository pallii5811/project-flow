export type Series = {
  id: string;
  title: string;
  coverUrl: string;
  totalEpisodes: number;
};

export type ContentItem = {
  id: string;
  seriesId: string;
  episodeId: string;
  episodeNumber: number;
  title: string;
  seriesTitle: string;
  /** Short narrative hook shown under the series title (1–2 lines). */
  hook: string;
  thumbnailUrl: string;
  videoUrl: string;
  durationMs: number;
  language: string;
  captionsAvailable: boolean;
  captionText?: string;
  order: number;
  /** Lightweight tags for Recommendation V0 — not Scene Graph. */
  genres: string[];
  tropes: string[];
  editorialPriority: number;
  popularityScore: number;
};

export type FeedCatalog = {
  series: Series[];
  items: ContentItem[];
};
