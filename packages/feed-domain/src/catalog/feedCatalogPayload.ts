/**
 * The catalog as the browser receives it.
 *
 * The feed never ships the TypeScript catalog in its JavaScript bundle. At
 * build time the catalog is written as static JSON (apps/web/src/app/catalog/
 * feed.json/route.ts), and the few items needed for the first frame are
 * inlined in each page. Both use this payload, which drops what the feed never
 * shows (long descriptions) and every field that can be derived from another.
 *
 * Deriving is only safe while the catalog keeps those invariants, so
 * `toFeedCatalogPayload` refuses a catalog that breaks one: the build fails
 * instead of shipping an episode with the wrong poster or video.
 */
import type {
  CaptionTrack,
  ContentItem,
  FeedCatalog,
  PlaybackDescriptor,
  Series,
} from "../model/types";
import { toPublishedCatalog } from "../model/validate";
import { isPlayableItem } from "../playback/isPlayable";

export const FEED_CATALOG_PAYLOAD_VERSION = 1;

export type FeedItemCopy = { title: string; hook: string };

export type FeedItemPayload = {
  id: string;
  seriesId: string;
  episodeId: string;
  episodeNumber: number;
  episodeSlug: string;
  title: string;
  hook: string;
  order: number;
  genres: string[];
  tropes: string[];
  editorialPriority: number;
  popularityScore: number;
  language: string;
  defaultLocale: string;
  playback: PlaybackDescriptor;
  captions: CaptionTrack[];
  /** Localized title and hook per locale; descriptions are not shown in the feed. */
  copy: Record<string, FeedItemCopy>;
};

export type FeedCatalogPayload = {
  version: typeof FEED_CATALOG_PAYLOAD_VERSION;
  series: Series[];
  /** Feed order for the full catalog; [target, next] for a first-frame payload. */
  items: FeedItemPayload[];
};

function titlesAndHooks(
  localized: ContentItem["localizedMetadata"],
): Record<string, FeedItemCopy> {
  const copy: Record<string, FeedItemCopy> = {};
  for (const [locale, strings] of Object.entries(localized)) {
    copy[locale] = { title: strings.title, hook: strings.hook };
  }
  return copy;
}

function toItemPayload(item: ContentItem, series: Series): FeedItemPayload {
  const broken: string[] = [];
  if (item.thumbnailUrl !== item.playback.posterReference) broken.push("thumbnailUrl");
  if (item.videoUrl !== item.playback.reference) broken.push("videoUrl");
  if (item.durationMs !== item.playback.durationMs) broken.push("durationMs");
  if (item.seriesTitle !== series.title) broken.push("seriesTitle");
  if (item.captionsAvailable !== item.captions.some((track) => track.status === "ready"))
    broken.push("captionsAvailable");
  if (broken.length > 0) {
    throw new Error(
      `Catalog item ${item.id} cannot be sent to the feed: ${broken.join(", ")} differ from the value they are derived from`,
    );
  }
  const copy = titlesAndHooks(item.localizedMetadata);
  return {
    id: item.id,
    seriesId: item.seriesId,
    episodeId: item.episodeId,
    episodeNumber: item.episodeNumber,
    episodeSlug: item.episodeSlug,
    title: item.title,
    hook: item.hook,
    order: item.order,
    genres: item.genres,
    tropes: item.tropes,
    editorialPriority: item.editorialPriority,
    popularityScore: item.popularityScore,
    language: item.language,
    defaultLocale: item.defaultLocale,
    playback: item.playback,
    captions: item.captions,
    copy,
  };
}

function build(catalog: FeedCatalog, items: ContentItem[]): FeedCatalogPayload {
  const seriesById = new Map(catalog.series.map((entry) => [entry.id, entry]));
  const usedSeries = new Map<string, Series>();
  const payloadItems: FeedItemPayload[] = [];
  for (const item of items) {
    const series = seriesById.get(item.seriesId);
    if (!series) continue;
    if (!usedSeries.has(series.id)) {
      usedSeries.set(series.id, {
        ...series,
        localizedMetadata: titlesAndHooks(series.localizedMetadata),
      });
    }
    payloadItems.push(toItemPayload(item, series));
  }
  return {
    version: FEED_CATALOG_PAYLOAD_VERSION,
    series: [...usedSeries.values()],
    items: payloadItems,
  };
}

function feedOrder(catalog: FeedCatalog, now: number): ContentItem[] {
  return toPublishedCatalog(catalog, now)
    .items.filter((item) => isPlayableItem(item, now))
    .sort((a, b) => a.order - b.order);
}

/** Every published, playable episode in feed order. */
export function toFeedCatalogPayload(
  catalog: FeedCatalog,
  now = Date.now(),
): FeedCatalogPayload {
  return build(catalog, feedOrder(catalog, now));
}

/**
 * What a page needs to paint and play its first frame: the target episode
 * (the first in feed order when there is none) and the episode after it —
 * the next in its series when there is one, so auto-continue works before the
 * full catalog arrives; otherwise the next in feed order.
 */
export function firstFramePayload(
  catalog: FeedCatalog,
  targetId: string | null = null,
  now = Date.now(),
): FeedCatalogPayload {
  const ordered = feedOrder(catalog, now);
  const position = targetId ? ordered.findIndex((item) => item.id === targetId) : 0;
  const target = ordered[position];
  if (!target) return build(catalog, []);
  const nextInSeries = ordered.find(
    (item) =>
      item.seriesId === target.seriesId && item.episodeNumber === target.episodeNumber + 1,
  );
  const next = nextInSeries ?? ordered[position + 1];
  return build(catalog, next ? [target, next] : [target]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Payload → catalog. The result still goes through createDeterministicFeedSource,
 * which validates every item, so this only rebuilds what was derived.
 */
export function fromFeedCatalogPayload(raw: unknown): FeedCatalog {
  if (!isRecord(raw) || raw.version !== FEED_CATALOG_PAYLOAD_VERSION) {
    throw new Error("Feed catalog payload has an unknown version");
  }
  if (!Array.isArray(raw.series) || !Array.isArray(raw.items)) {
    throw new Error("Feed catalog payload is malformed");
  }
  const series = raw.series as Series[];
  const titles = new Map(series.map((entry) => [entry.id, entry.title]));
  const items: ContentItem[] = (raw.items as FeedItemPayload[]).map((item) => {
    const localizedMetadata: ContentItem["localizedMetadata"] = {};
    for (const [locale, strings] of Object.entries(item.copy ?? {})) {
      localizedMetadata[locale] = { title: strings.title, hook: strings.hook };
    }
    return {
      id: item.id,
      seriesId: item.seriesId,
      episodeId: item.episodeId,
      episodeNumber: item.episodeNumber,
      episodeSlug: item.episodeSlug,
      status: "published",
      title: item.title,
      seriesTitle: titles.get(item.seriesId) ?? "",
      hook: item.hook,
      thumbnailUrl: item.playback.posterReference,
      videoUrl: item.playback.reference,
      playback: item.playback,
      captions: item.captions,
      captionsAvailable: item.captions.some((track) => track.status === "ready"),
      durationMs: item.playback.durationMs,
      language: item.language,
      defaultLocale: item.defaultLocale,
      localizedMetadata,
      order: item.order,
      genres: item.genres,
      tropes: item.tropes,
      editorialPriority: item.editorialPriority,
      popularityScore: item.popularityScore,
    };
  });
  return { series, items };
}
