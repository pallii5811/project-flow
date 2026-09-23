/**
 * Series manifests: what a studio delivery becomes once it has passed the
 * gate (CP-1, F8).
 *
 * A manifest is written by `scripts/ingest-series.mjs` from MEASURED facts —
 * the duration ffmpeg read from the packaged episode, the captions that were
 * parsed, the poster that exists on disk — and nothing in it is typed by
 * hand. The catalog is built from manifests, so a wrong duration or a missing
 * poster is now a failed ingest instead of a typo nobody notices.
 *
 * Rights (F8) travel with the series: territories, languages and the window.
 * `catalogFromManifests` refuses a manifest without them, and
 * `toPublishedCatalog` hides a series whose window is closed.
 */
import type {
  CaptionTrack,
  ContentItem,
  FeedCatalog,
  LocalizedMetadata,
  PlaybackDescriptor,
  Series,
  SeriesRights,
} from "../model/types";

export const SERIES_MANIFEST_VERSION = 2;

export type ManifestCaptionTrack = CaptionTrack & {
  /** Cues counted when the file was parsed at ingest. */
  cues: number;
  /** Share of the episode covered by cues, 0–1. */
  coverage: number;
};

export type EpisodeManifest = {
  episodeNumber: number;
  episodeSlug: string;
  title: string;
  hook: string;
  localizedMetadata: LocalizedMetadata;
  /** Measured by ffmpeg on the master, never declared. */
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  /** Adaptive playlist, poster and landscape share card, relative to the site. */
  playbackReference: string;
  posterReference: string;
  shareCardReference: string;
  captions: ManifestCaptionTrack[];
  /** Identity of the delivered master: the same file twice is refused. */
  sourceSha256: string;
  /** Loudness of the packaged audio, measured back (EBU R128). */
  publishedLufs: number;
  genres: string[];
  tropes: string[];
};

export type SeriesManifest = {
  schemaVersion: typeof SERIES_MANIFEST_VERSION;
  seriesId: string;
  seriesSlug: string;
  title: string;
  status: Series["status"];
  defaultLocale: string;
  localizedMetadata: LocalizedMetadata;
  /** Producer of record: who is paid, and who answers for the rights. */
  producerId: string;
  producerOfRecord: string;
  socialClipsAllowed: boolean;
  /**
   * Where the written OK to post clips is, when there is one. Clipping a work
   * publishes a piece of it on somebody else's platform, so the licence has to
   * say it may be done — the same shape `splitPermission` takes before a file
   * is cut. It stays in the manifest and never reaches the browser: only
   * `scripts/make-clips.mjs` reads it.
   */
  socialClipsPermission?: { grantedOn: string; source: string } | null;
  rights: SeriesRights;
  /** ISO-8601 instant the pack was ingested. */
  packagedAt: string;
  /** Rules the episodes passed, from scripts/lib/media-gate.mjs. */
  gateVersion: number;
  episodes: EpisodeManifest[];
};

/** `series_signal` → `signal`, so ids stay stable and readable. */
function idBase(seriesId: string): string {
  return seriesId.startsWith("series_") ? seriesId.slice("series_".length) : seriesId;
}

function playbackFor(episode: EpisodeManifest, expiresAt: string | null): PlaybackDescriptor {
  return {
    provider: "hls",
    reference: episode.playbackReference,
    mimeType: "application/vnd.apple.mpegurl",
    durationMs: episode.durationMs,
    width: episode.width,
    height: episode.height,
    aspectRatio: episode.width / episode.height,
    posterReference: episode.posterReference,
    shareCardReference: episode.shareCardReference,
    expiresAt,
    preloadHint: "metadata",
  };
}

function toSeries(manifest: SeriesManifest): Series {
  return {
    id: manifest.seriesId,
    seriesSlug: manifest.seriesSlug,
    title: manifest.title,
    status: manifest.status,
    coverUrl: manifest.episodes[0]?.posterReference ?? "",
    totalEpisodes: manifest.episodes.length,
    defaultLocale: manifest.defaultLocale,
    localizedMetadata: manifest.localizedMetadata,
    producerId: manifest.producerId,
    socialClipsAllowed: manifest.socialClipsAllowed,
    rights: manifest.rights,
  };
}

function toItem(
  manifest: SeriesManifest,
  episode: EpisodeManifest,
  order: number,
): ContentItem {
  const base = idBase(manifest.seriesId);
  // The rights window is also the episode's expiry: an episode never outlives
  // the licence it is shown under.
  const playback = playbackFor(episode, manifest.rights.windowEnd);
  const captions: CaptionTrack[] = episode.captions.map((track) => ({
    language: track.language,
    url: track.url,
    kind: track.kind,
    default: track.default,
    status: track.status,
  }));
  return {
    id: `item_${base}_${episode.episodeNumber}`,
    seriesId: manifest.seriesId,
    episodeId: `ep_${base}_${episode.episodeNumber}`,
    episodeNumber: episode.episodeNumber,
    episodeSlug: episode.episodeSlug,
    status: manifest.status,
    title: episode.title,
    seriesTitle: manifest.title,
    hook: episode.hook,
    thumbnailUrl: playback.posterReference,
    videoUrl: playback.reference,
    playback,
    captions,
    captionsAvailable: captions.some((track) => track.status === "ready"),
    durationMs: playback.durationMs,
    language: manifest.defaultLocale,
    defaultLocale: manifest.defaultLocale,
    localizedMetadata: episode.localizedMetadata,
    order,
    genres: episode.genres,
    tropes: episode.tropes,
    editorialPriority: 100 - order,
    popularityScore: 90 - order,
  };
}

/**
 * Manifests → catalog, in the order the manifests are listed. The order of an
 * episode is its place in the whole feed, so generated scale episodes
 * (STRESS_ORDER_OFFSET) still sort after every real one.
 */
export function catalogFromManifests(manifests: readonly SeriesManifest[]): FeedCatalog {
  const series: Series[] = [];
  const items: ContentItem[] = [];
  let order = 0;
  for (const manifest of manifests) {
    if (manifest.schemaVersion !== SERIES_MANIFEST_VERSION) {
      throw new Error(
        `Series manifest ${manifest.seriesSlug} has schema ${manifest.schemaVersion}, expected ${SERIES_MANIFEST_VERSION}: run scripts/ingest-series.mjs again`,
      );
    }
    series.push(toSeries(manifest));
    const episodes = [...manifest.episodes].sort(
      (a, b) => a.episodeNumber - b.episodeNumber,
    );
    for (const episode of episodes) {
      items.push(toItem(manifest, episode, order));
      order += 1;
    }
  }
  return { series, items };
}
