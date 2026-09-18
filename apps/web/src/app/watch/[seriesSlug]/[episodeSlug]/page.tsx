import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  findBySlugs,
  firstFramePayload,
  resolveDisplayCopy,
  watchPath,
} from "@project-flow/feed-domain";

import { FeedDocument } from "@/features/feed/FeedDocument";
import { getWebFeedCatalog } from "@/lib/feedCatalog";
import { watchMetadata } from "@/lib/siteMetadata";

type WatchParams = {
  seriesSlug: string;
  episodeSlug: string;
};

type WatchPageProps = {
  params: Promise<WatchParams>;
};

/**
 * Static export: one HTML file per published episode, so a shared link is a
 * plain file on the CDN. Publication and expiry are evaluated at BUILD time —
 * a rights window that closes needs a rebuild to remove its page.
 */
export const dynamicParams = false;

export function generateStaticParams(): WatchParams[] {
  const catalog = getWebFeedCatalog();
  const slugBySeries = new Map(catalog.series.map((entry) => [entry.id, entry.seriesSlug]));
  return catalog.items.flatMap((item) => {
    const seriesSlug = slugBySeries.get(item.seriesId);
    return seriesSlug ? [{ seriesSlug, episodeSlug: item.episodeSlug }] : [];
  });
}

function findPublished({ seriesSlug, episodeSlug }: WatchParams) {
  return findBySlugs(getWebFeedCatalog(), seriesSlug, episodeSlug, {
    publishedOnly: true,
  });
}

export async function generateMetadata({ params }: WatchPageProps): Promise<Metadata> {
  const resolved = await params;
  const item = findPublished(resolved);
  if (!item) {
    return { title: "Not found", description: "This episode is unavailable." };
  }
  const copy = resolveDisplayCopy(item, "en");
  // Each episode has its own title and preview line (VIR-5): links to
  // episode 1 and episode 40 must not look the same in a chat.
  return watchMetadata(
    {
      seriesTitle: item.seriesTitle,
      episodeNumber: item.episodeNumber,
      episodeTitle: copy.title,
      hook: copy.hook,
      shareCardUrl: item.playback.shareCardReference,
    },
    watchPath(resolved),
  );
}

export default async function WatchPage({ params }: WatchPageProps) {
  const resolved = await params;
  const item = findPublished(resolved);
  if (!item) notFound();
  const initial = firstFramePayload(getWebFeedCatalog(), item.id);
  // Published at build time but not playable (for example no video): the
  // feed has nothing to open, which is the same as an unknown episode.
  if (initial.items.length === 0) notFound();

  return (
    <FeedDocument
      initial={initial}
      initialContentId={item.id}
      deepLinkRoute={watchPath(resolved)}
    />
  );
}
