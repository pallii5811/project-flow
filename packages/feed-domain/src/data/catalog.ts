/**
 * LAUNCH CATALOG (L1) — web source of truth.
 *
 * Assets: cleared original vertical stand-ins under `/content/series/signal-night/`.
 * Generated in-repo (ffmpeg color beds). NOT licensed short drama.
 * Do not present as a commercial title.
 *
 * Mobile keeps a separate legacy fixture catalog and is not launch-critical.
 */
import type {
  ContentItem,
  FeedCatalog,
  LocalizedMetadata,
  PlaybackDescriptor,
  Series,
} from "../model/types";
import { toPublishedCatalog, validateCatalog } from "../model/validate";

const PACK = "/content/series/signal-night";
const W = 720;
const H = 1280;
const ASPECT = W / H;
const DURATION_MS = 10_000;

function playbackFor(episodeFile: string, expiresAt: string | null = null): PlaybackDescriptor {
  return {
    provider: "static",
    reference: `${PACK}/video/${episodeFile}.mp4`,
    mimeType: "video/mp4",
    durationMs: DURATION_MS,
    width: W,
    height: H,
    aspectRatio: ASPECT,
    posterReference: `${PACK}/posters/${episodeFile}.jpg`,
    expiresAt,
    preloadHint: "metadata",
  };
}

function enMeta(title: string, hook: string, description: string): LocalizedMetadata {
  return {
    en: { title, hook, description },
    es: {
      title,
      hook: hook.replace(/\n/g, " "),
      description: "Paquete de prueba vertical liberado (no es drama con licencia).",
    },
    "pt-BR": {
      title,
      hook: hook.replace(/\n/g, " "),
      description: "Pacote vertical liberado para testes (não é drama licenciado).",
    },
  };
}

const SERIES_SIGNAL: Series = {
  id: "series_signal",
  seriesSlug: "signal-night",
  title: "Signal Night",
  status: "published",
  coverUrl: `${PACK}/posters/episode-1.jpg`,
  totalEpisodes: 5,
  defaultLocale: "en",
  localizedMetadata: enMeta(
    "Signal Night",
    "A cleared vertical stand-in pack.\nNot licensed short drama.",
    "Original generative vertical fixtures for PROJECT FLOW launch playback validation.",
  ),
};

/** Draft series — must never appear in consumer feed. */
const SERIES_DRAFT: Series = {
  id: "series_draft_probe",
  seriesSlug: "draft-probe",
  title: "Draft Probe",
  status: "draft",
  coverUrl: `${PACK}/posters/episode-1.jpg`,
  totalEpisodes: 1,
  defaultLocale: "en",
  localizedMetadata: enMeta("Draft Probe", "Should not ship.", "Draft only."),
};

function captionsFor(episodeFile: string, includeEs: boolean): ContentItem["captions"] {
  const tracks: ContentItem["captions"] = [
    {
      language: "en",
      url: `${PACK}/captions/${episodeFile}.en.vtt`,
      kind: "captions",
      default: true,
      status: "ready",
    },
  ];
  if (includeEs) {
    tracks.push({
      language: "es",
      url: `${PACK}/captions/${episodeFile}.es.vtt`,
      kind: "subtitles",
      default: false,
      status: "ready",
    });
  }
  return tracks;
}

function makeItem(opts: {
  id: string;
  series: Series;
  episodeId: string;
  episodeNumber: number;
  episodeSlug: string;
  episodeFile: string;
  title: string;
  hook: string;
  order: number;
  status: ContentItem["status"];
  expiresAt?: string | null;
  includeEs?: boolean;
}): ContentItem {
  const pb = playbackFor(opts.episodeFile, opts.expiresAt ?? null);
  const captions = captionsFor(opts.episodeFile, opts.includeEs === true);
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
    thumbnailUrl: pb.posterReference,
    videoUrl: pb.reference,
    playback: pb,
    captions,
    captionsAvailable: captions.some((t) => t.status === "ready"),
    durationMs: pb.durationMs,
    language: "en",
    defaultLocale: "en",
    localizedMetadata: enMeta(opts.title, opts.hook, `${opts.series.title} · ${opts.title}`),
    order: opts.order,
    genres: ["thriller", "drama"],
    tropes: ["mystery", "night"],
    editorialPriority: 100 - opts.order,
    popularityScore: 90 - opts.order,
  };
}

const HOOKS: Array<{ title: string; hook: string }> = [
  { title: "The Signal", hook: "Something is wrong with the night.\nDo not answer." },
  { title: "After Dark", hook: "The frequency finds you.\nYou do not find it." },
  { title: "No Reply", hook: "She waited three seconds too long." },
  { title: "Last Frame", hook: "The recording ends where the story starts." },
  { title: "Stay Quiet", hook: "If you can hear this,\nyou are already in it." },
];

const publishedItems: ContentItem[] = HOOKS.map((entry, index) => {
  const n = index + 1;
  return makeItem({
    id: `item_signal_${n}`,
    series: SERIES_SIGNAL,
    episodeId: `ep_signal_${n}`,
    episodeNumber: n,
    episodeSlug: `episode-${n}`,
    episodeFile: `episode-${n}`,
    title: entry.title,
    hook: entry.hook,
    order: index,
    status: "published",
    includeEs: n === 1,
  });
});

/** Hostile fixtures for validation / deep-link tests — never published into feed. */
const probeItems: ContentItem[] = [
  makeItem({
    id: "item_draft_probe_1",
    series: SERIES_DRAFT,
    episodeId: "ep_draft_1",
    episodeNumber: 1,
    episodeSlug: "episode-1",
    episodeFile: "episode-1",
    title: "Draft Episode",
    hook: "Draft — excluded.",
    order: 100,
    status: "draft",
  }),
  makeItem({
    id: "item_signal_expired_probe",
    series: SERIES_SIGNAL,
    episodeId: "ep_signal_expired_probe",
    episodeNumber: 90,
    episodeSlug: "expired-probe",
    episodeFile: "episode-1",
    title: "Expired Episode",
    hook: "Expired — excluded.",
    order: 101,
    status: "expired",
    expiresAt: "2020-01-01T00:00:00.000Z",
  }),
  makeItem({
    id: "item_signal_unpublished_probe",
    series: SERIES_SIGNAL,
    episodeId: "ep_signal_unpublished_probe",
    episodeNumber: 91,
    episodeSlug: "unpublished-probe",
    episodeFile: "episode-1",
    title: "Unpublished Episode",
    hook: "Unpublished — excluded.",
    order: 102,
    status: "unpublished",
  }),
];

/** Full seed including probes. Prefer getLaunchFeedCatalog for consumers. */
export const RAW_LAUNCH_SEED: FeedCatalog = {
  series: [SERIES_SIGNAL, SERIES_DRAFT],
  items: [...publishedItems, ...probeItems],
};

const validated = validateCatalog(RAW_LAUNCH_SEED);
if (!validated.ok) {
  throw new Error(
    `Launch catalog invalid: ${validated.issues.map((i) => `${i.code}@${i.path}`).join("; ")}`,
  );
}

/** Full validated seed (includes non-published probes for tests). */
export const LAUNCH_CATALOG: FeedCatalog = validated.catalog;

/** Consumer feed catalog — published only. */
export function getLaunchFeedCatalog(now = Date.now()): FeedCatalog {
  return toPublishedCatalog(LAUNCH_CATALOG, now);
}

/**
 * @deprecated Use LAUNCH_CATALOG / getLaunchFeedCatalog.
 * Alias for the published launch feed (no GTV/Picsum).
 */
export const MOCK_CATALOG: FeedCatalog = getLaunchFeedCatalog();
