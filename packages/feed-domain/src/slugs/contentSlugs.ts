import type { ContentItem, FeedCatalog } from "../model/types";

/** Lowercase URL slug: strip punctuation, collapse whitespace/symbols to hyphens. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function episodeSlugFor(episodeNumber: number): string {
  return `episode-${episodeNumber}`;
}

export type FindBySlugsOptions = {
  /** When true, draft/unpublished/expired never resolve (deep-link consumer). */
  publishedOnly?: boolean;
  now?: number;
};

export function findBySlugs(
  catalog: FeedCatalog,
  seriesSlug: string,
  episodeSlug: string,
  options: FindBySlugsOptions = {},
): ContentItem | null {
  const publishedOnly = options.publishedOnly !== false;
  const now = options.now ?? Date.now();
  const series = catalog.series.find((entry) => entry.seriesSlug === seriesSlug);
  if (!series) return null;
  if (publishedOnly && series.status !== "published") return null;
  const item =
    catalog.items.find(
      (candidate) =>
        candidate.seriesId === series.id && candidate.episodeSlug === episodeSlug,
    ) ?? null;
  if (!item) return null;
  if (publishedOnly && item.status !== "published") return null;
  if (publishedOnly && item.playback.expiresAt) {
    const expires = Date.parse(item.playback.expiresAt);
    if (Number.isFinite(expires) && expires <= now) return null;
  }
  return item;
}

/** Canonical watch URL for a slug pair (or ContentItem + seriesSlug). */
export function watchPath(item: { seriesSlug: string; episodeSlug: string }): string {
  return `/watch/${item.seriesSlug}/${item.episodeSlug}`;
}

export function watchPathForItem(catalog: FeedCatalog, item: ContentItem): string | null {
  const series = catalog.series.find((entry) => entry.id === item.seriesId);
  if (!series) return null;
  return watchPath({ seriesSlug: series.seriesSlug, episodeSlug: item.episodeSlug });
}
