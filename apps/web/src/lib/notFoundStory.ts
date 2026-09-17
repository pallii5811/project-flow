import {
  firstFramePayload,
  watchPath,
  type FeedCatalog,
} from "@project-flow/feed-domain";

export type NotFoundStory = {
  href: string;
  seriesTitle: string;
  /** First line of the hook only: the card stays two lines tall. */
  hook: string;
  posterUrl: string;
  episodeLabel: string;
};

/**
 * The story a lost visitor is offered (UX-10): the one the feed opens on,
 * from the episode the feed would play. Null when nothing can play, and the
 * page then offers the feed alone.
 */
export function notFoundStory(
  catalog: FeedCatalog,
  now = Date.now(),
): NotFoundStory | null {
  const payload = firstFramePayload(catalog, null, now);
  const lead = payload.items[0];
  if (!lead) return null;
  const series = payload.series.find((entry) => entry.id === lead.seriesId);
  if (!series) return null;
  return {
    href: watchPath({ seriesSlug: series.seriesSlug, episodeSlug: lead.episodeSlug }),
    seriesTitle: series.title,
    hook: lead.hook.split("\n")[0] ?? "",
    posterUrl: lead.playback.posterReference,
    episodeLabel: `Episode ${lead.episodeNumber}`,
  };
}
