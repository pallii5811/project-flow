/**
 * LAUNCH CATALOG (L1) — web source of truth.
 *
 * The published series are NOT typed here any more: they are built from the
 * series manifests under `data/generated/`, which `scripts/ingest-series.mjs`
 * writes from the packaged episodes (CP-1). Durations, poster and caption
 * URLs, rights and the producer of record therefore describe files that exist
 * and were measured, instead of numbers somebody kept in step by hand.
 *
 * Assets: cleared original vertical stand-ins under `/content/series/signal-night/`.
 * Generated in-repo (ffmpeg colour beds and an audio bed). NOT licensed short
 * drama. Do not present as a commercial title.
 *
 * What stays hand-written below are the hostile fixtures — a draft series, an
 * expired episode, an unpublished one — because they are tests of the feed's
 * refusals, not content.
 *
 * Mobile keeps a separate legacy fixture catalog and is not launch-critical.
 */
import type {
  ContentItem,
  FeedCatalog,
  LocalizedMetadata,
  PlaybackDescriptor,
  Series,
  SeriesRights,
} from "../model/types";
import { toPublishedCatalog, validateCatalog } from "../model/validate";
import { catalogFromManifests } from "../content/seriesManifest";
import { SERIES_MANIFESTS } from "./generated";

/** Everything the manifests describe: series, episodes, rights, captions. */
const ingested = catalogFromManifests(SERIES_MANIFESTS);

const signalNight = ingested.series.find((entry) => entry.seriesSlug === "signal-night");
if (!signalNight) {
  throw new Error(
    "No signal-night manifest: run `node scripts/ingest-series.mjs` before building",
  );
}
const found = ingested.items.find((item) => item.seriesId === signalNight.id);
if (!found) {
  throw new Error("The signal-night manifest has no episodes");
}
const firstEpisode: ContentItem = found;

function enMeta(title: string, hook: string, description: string): LocalizedMetadata {
  return { en: { title, hook, description } };
}

const PROBE_RIGHTS: SeriesRights = {
  territories: ["WORLD"],
  languages: ["en"],
  windowStart: null,
  windowEnd: null,
};

/** Draft series — must never appear in consumer feed. */
const SERIES_DRAFT: Series = {
  id: "series_draft_probe",
  seriesSlug: "draft-probe",
  title: "Draft Probe",
  status: "draft",
  coverUrl: firstEpisode.thumbnailUrl,
  totalEpisodes: 1,
  defaultLocale: "en",
  localizedMetadata: enMeta("Draft Probe", "Should not ship.", "Draft only."),
  producerId: "prod_standin_inhouse",
  socialClipsAllowed: false,
  rights: PROBE_RIGHTS,
};

/** A probe reuses the first episode's real assets: only its status is hostile. */
function probePlayback(expiresAt: string | null = null): PlaybackDescriptor {
  return { ...firstEpisode.playback, expiresAt };
}

function makeProbe(opts: {
  id: string;
  series: Series;
  episodeId: string;
  episodeNumber: number;
  episodeSlug: string;
  title: string;
  hook: string;
  order: number;
  status: ContentItem["status"];
  expiresAt?: string | null;
}): ContentItem {
  const playback = probePlayback(opts.expiresAt ?? null);
  return {
    id: opts.id,
    seriesId: opts.series.id,
    episodeId: opts.episodeId,
    episodeNumber: opts.episodeNumber,
    episodeSlug: opts.episodeSlug,
    status: opts.status,
    title: opts.title,
    seriesTitle: opts.series.title,
    hook: opts.hook,
    thumbnailUrl: playback.posterReference,
    videoUrl: playback.reference,
    playback,
    captions: firstEpisode.captions,
    captionsAvailable: firstEpisode.captionsAvailable,
    durationMs: playback.durationMs,
    language: "en",
    defaultLocale: "en",
    localizedMetadata: enMeta(
      opts.title,
      opts.hook,
      `${opts.series.title} · ${opts.title}`,
    ),
    order: opts.order,
    genres: firstEpisode.genres,
    tropes: firstEpisode.tropes,
    editorialPriority: 0,
    popularityScore: 0,
  };
}

/** Hostile fixtures for validation / deep-link tests — never published into feed. */
const probeItems: ContentItem[] = [
  makeProbe({
    id: "item_draft_probe_1",
    series: SERIES_DRAFT,
    episodeId: "ep_draft_1",
    episodeNumber: 1,
    episodeSlug: "episode-1",
    title: "Draft Episode",
    hook: "Draft — excluded.",
    order: 100,
    status: "draft",
  }),
  makeProbe({
    id: "item_signal_expired_probe",
    series: signalNight,
    episodeId: "ep_signal_expired_probe",
    episodeNumber: 90,
    episodeSlug: "expired-probe",
    title: "Expired Episode",
    hook: "Expired — excluded.",
    order: 101,
    status: "expired",
    expiresAt: "2020-01-01T00:00:00.000Z",
  }),
  makeProbe({
    id: "item_signal_unpublished_probe",
    series: signalNight,
    episodeId: "ep_signal_unpublished_probe",
    episodeNumber: 91,
    episodeSlug: "unpublished-probe",
    title: "Unpublished Episode",
    hook: "Unpublished — excluded.",
    order: 102,
    status: "unpublished",
  }),
];

/** Full seed including probes. Prefer getLaunchFeedCatalog for consumers. */
export const RAW_LAUNCH_SEED: FeedCatalog = {
  series: [...ingested.series, SERIES_DRAFT],
  items: [...ingested.items, ...probeItems],
};

const validated = validateCatalog(RAW_LAUNCH_SEED);
if (!validated.ok) {
  throw new Error(
    `Launch catalog invalid: ${validated.issues.map((i) => `${i.code}@${i.path}`).join("; ")}`,
  );
}

/** Full validated seed (includes non-published probes for tests). */
export const LAUNCH_CATALOG: FeedCatalog = validated.catalog;

/** Consumer feed catalog — published only, and inside its rights window. */
export function getLaunchFeedCatalog(now = Date.now()): FeedCatalog {
  return toPublishedCatalog(LAUNCH_CATALOG, now);
}

/**
 * @deprecated Use LAUNCH_CATALOG / getLaunchFeedCatalog.
 * Alias for the published launch feed (no GTV/Picsum).
 */
export const MOCK_CATALOG: FeedCatalog = getLaunchFeedCatalog();
