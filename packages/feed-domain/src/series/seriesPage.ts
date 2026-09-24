/**
 * What a page ABOUT a series shows, built from the catalog at build time.
 *
 * The feed is the product; this is the page a clip viewer opens when they
 * want to know what they are watching, and the one a search engine will index
 * once the beta opens. It is derived, never typed by hand: an episode list
 * that disagrees with what plays is worse than no list.
 */
import type { ContentItem, FeedCatalog, Series } from "../model/types";
import { isPlayableItem } from "../playback/isPlayable";
import { resolveDisplayCopy } from "../i18n/resolveLocale";
import { toPublishedCatalog } from "../model/validate";
import { watchPath } from "../slugs/contentSlugs";

export type SeriesPageEpisode = {
  contentId: string;
  episodeNumber: number;
  episodeSlug: string;
  /** Canonical watch address of this episode. */
  href: string;
  title: string;
  hook: string;
  posterUrl: string;
  durationMs: number;
};

export type SeriesPageData = {
  seriesId: string;
  seriesSlug: string;
  title: string;
  hook: string;
  description: string;
  /** Deduplicated, in the order the episodes declare them. */
  genres: string[];
  /** Episodes that really play, in order. Never `series.totalEpisodes`. */
  episodes: SeriesPageEpisode[];
  /** The whole story end to end, from the measured episode durations. */
  totalDurationMs: number;
  /** Landscape 1200×630 card of episode 1, for the link preview. */
  shareCardUrl: string;
};

function publishedEpisodesOf(
  catalog: FeedCatalog,
  series: Series,
  now: number,
): ContentItem[] {
  return toPublishedCatalog(catalog, now)
    .items.filter((item) => item.seriesId === series.id && isPlayableItem(item, now))
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
}

/** Every series with at least one playable episode, in feed order. */
export function seriesPageSlugs(catalog: FeedCatalog, now = Date.now()): string[] {
  const published = toPublishedCatalog(catalog, now);
  const withEpisodes = new Set(
    published.items.filter((item) => isPlayableItem(item, now)).map((item) => item.seriesId),
  );
  return published.series
    .filter((series) => withEpisodes.has(series.id))
    .map((series) => series.seriesSlug);
}

/**
 * The page for one slug, or null when nothing of it can be watched — an
 * unknown slug, a closed licence window, a series whose episodes are all
 * unpublished. The page then does not exist, instead of existing and lying.
 */
export function seriesPageData(
  catalog: FeedCatalog,
  seriesSlug: string,
  locale = "en",
  now = Date.now(),
): SeriesPageData | null {
  const published = toPublishedCatalog(catalog, now);
  const series = published.series.find((entry) => entry.seriesSlug === seriesSlug);
  if (!series) return null;
  const items = publishedEpisodesOf(catalog, series, now);
  const first = items[0];
  if (!first) return null;

  const seriesCopy = resolveDisplayCopy(
    {
      defaultLocale: series.defaultLocale,
      localizedMetadata: series.localizedMetadata,
      title: series.title,
      hook: "",
    },
    locale,
  );
  const genres: string[] = [];
  for (const item of items) {
    for (const genre of item.genres) {
      if (!genres.includes(genre)) genres.push(genre);
    }
  }

  return {
    seriesId: series.id,
    seriesSlug: series.seriesSlug,
    title: seriesCopy.title || series.title,
    // The series' own hook when it has one, else the first episode's: the
    // line on the card a viewer arrived from.
    hook: oneLine(seriesCopy.hook || resolveDisplayCopy(first, locale).hook),
    description: oneLine(seriesCopy.description ?? ""),
    genres,
    episodes: items.map((item) => {
      const copy = resolveDisplayCopy(item, locale);
      return {
        contentId: item.id,
        episodeNumber: item.episodeNumber,
        episodeSlug: item.episodeSlug,
        href: watchPath({
          seriesSlug: series.seriesSlug,
          episodeSlug: item.episodeSlug,
        }),
        title: copy.title,
        hook: oneLine(copy.hook),
        posterUrl: item.playback.posterReference,
        durationMs: item.playback.durationMs,
      };
    }),
    totalDurationMs: items.reduce((total, item) => total + item.playback.durationMs, 0),
    shareCardUrl: first.playback.shareCardReference,
  };
}

/** Hooks are written with line breaks for the feed; a page reads them as prose. */
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

export type BrowseSeries = {
  seriesSlug: string;
  title: string;
  hook: string;
  genres: string[];
  episodeCount: number;
  posterUrl: string;
  href: string;
};

/**
 * Everything that exists, for the one page that says so. Same derivation as
 * the series page, so a title listed here always has a page behind it.
 */
export function browseCatalog(
  catalog: FeedCatalog,
  locale = "en",
  now = Date.now(),
): BrowseSeries[] {
  return seriesPageSlugs(catalog, now).flatMap((slug) => {
    const data = seriesPageData(catalog, slug, locale, now);
    if (!data) return [];
    const first = data.episodes[0];
    if (!first) return [];
    return [
      {
        seriesSlug: data.seriesSlug,
        title: data.title,
        hook: data.hook,
        genres: data.genres,
        episodeCount: data.episodes.length,
        posterUrl: first.posterUrl,
        href: `/series/${data.seriesSlug}`,
      },
    ];
  });
}

/** The genres present in a listing, each once, most titles first then A–Z. */
export function browseGenres(series: readonly BrowseSeries[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of series) {
    for (const genre of entry.genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([genre]) => genre);
}
