/**
 * STRESS CATALOG — tests and e2e only, never a normal build.
 *
 * The launch pack has 5 episodes, so every speed number measured on it hides
 * what happens with the real catalog (45–60 series × 60–100 episodes). This
 * multiplies the stand-in pack into many series so a build can be measured at
 * catalog scale (`FLOW_STRESS_EPISODES=600`, see scripts/build-stress.mjs).
 *
 * The original episodes stay first and unchanged, so every existing check
 * (first episode, shared link, preload budget) still means the same thing.
 * Generated episodes reuse the stand-in media, and each gets its own poster
 * URL (a query string) so the browser cannot hide extra poster downloads by
 * de-duplicating one URL.
 */
import type { ContentItem, FeedCatalog, Series } from "../model/types";

export const STRESS_EPISODES_PER_SERIES = 60;
export const STRESS_EPISODES_MAX = 20_000;
/** Generated episodes sort after every real one. */
export const STRESS_ORDER_OFFSET = 1_000;

/**
 * Reads the stress size. Absent or empty means no stress (0). Anything else
 * that is not a whole number in range throws: a typo must not silently build
 * the normal catalog and make a scale run measure nothing.
 */
export function parseStressEpisodeCount(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 0;
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`FLOW_STRESS_EPISODES must be a whole number, got "${raw}"`);
  }
  const count = Number(value);
  if (count > STRESS_EPISODES_MAX) {
    throw new Error(
      `FLOW_STRESS_EPISODES must be at most ${STRESS_EPISODES_MAX}, got ${count}`,
    );
  }
  return count;
}

/**
 * Where the generated episodes' media is served from, for the scale run only.
 * With a base URL, their video, posters, cards and subtitles are addressed on
 * that origin instead of the site's — which is how media published to R2
 * reaches a viewer (docs/cloud-ingest.md). It is what lets `npm run
 * e2e:web:scale` prove, in a browser, that a catalog whose media is on
 * another host still plays, still shows its subtitles, and breaks no security
 * policy. Never set for a publishable build (scripts/deploy-checks.mjs
 * refuses a stress catalog anyway).
 */
export function parseStressMediaBase(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value === "") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`FLOW_STRESS_MEDIA_BASE must be a URL, got "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`FLOW_STRESS_MEDIA_BASE must be http(s), got "${raw}"`);
  }
  return value.replace(/\/+$/, "");
}

/** A site path ("/content/…") addressed on the media host; anything else untouched. */
function onMediaHost(url: string, base: string | null): string {
  return base && url.startsWith("/") ? `${base}${url}` : url;
}

/** The published catalog plus `count` generated episodes in series of 60. */
export function withStressEpisodes(
  base: FeedCatalog,
  count: number,
  mediaBase: string | null = null,
): FeedCatalog {
  if (count <= 0) return base;
  const templates = [...base.items]
    .filter((item) => item.status === "published")
    .sort((a, b) => a.order - b.order);
  const templateSeries = base.series.find((entry) => entry.status === "published");
  if (templates.length === 0 || !templateSeries) return base;

  const seriesCount = Math.ceil(count / STRESS_EPISODES_PER_SERIES);
  const series: Series[] = [];
  const items: ContentItem[] = [];

  for (let s = 0; s < seriesCount; s += 1) {
    const seriesNumber = s + 1;
    const episodes = Math.min(
      STRESS_EPISODES_PER_SERIES,
      count - s * STRESS_EPISODES_PER_SERIES,
    );
    const title = `Stress Series ${seriesNumber}`;
    const entry: Series = {
      ...templateSeries,
      id: `series_stress_${seriesNumber}`,
      seriesSlug: `stress-${seriesNumber}`,
      title,
      totalEpisodes: episodes,
    };
    series.push(entry);

    for (let e = 0; e < episodes; e += 1) {
      const episodeNumber = e + 1;
      const template = templates[(s * STRESS_EPISODES_PER_SERIES + e) % templates.length];
      if (!template) continue;
      const poster = onMediaHost(
        `${template.playback.posterReference}?stress=${seriesNumber}-${episodeNumber}`,
        mediaBase,
      );
      const video = onMediaHost(template.playback.reference, mediaBase);
      items.push({
        ...template,
        id: `item_stress_${seriesNumber}_${episodeNumber}`,
        seriesId: entry.id,
        episodeId: `ep_stress_${seriesNumber}_${episodeNumber}`,
        episodeNumber,
        episodeSlug: `episode-${episodeNumber}`,
        seriesTitle: title,
        thumbnailUrl: poster,
        videoUrl: video,
        captions: template.captions.map((track) => ({ ...track, url: onMediaHost(track.url, mediaBase) })),
        playback: {
          ...template.playback,
          reference: video,
          posterReference: poster,
          shareCardReference: onMediaHost(template.playback.shareCardReference, mediaBase),
        },
        order: STRESS_ORDER_OFFSET + items.length,
        // Below every real episode, like a long tail of the catalog.
        editorialPriority: 0,
        popularityScore: 0,
      });
    }
  }

  return { series: [...base.series, ...series], items: [...base.items, ...items] };
}
