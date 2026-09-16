import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { preload } from "react-dom";

import {
  findBySlugs,
  getLaunchFeedCatalog,
  resolveDisplayCopy,
  watchPath,
} from "@project-flow/feed-domain";

import { FeedApp } from "@/features/feed/FeedApp";

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
  const catalog = getLaunchFeedCatalog();
  return catalog.items.flatMap((item) => {
    const series = catalog.series.find((entry) => entry.id === item.seriesId);
    return series
      ? [{ seriesSlug: series.seriesSlug, episodeSlug: item.episodeSlug }]
      : [];
  });
}

function findPublished({ seriesSlug, episodeSlug }: WatchParams) {
  return findBySlugs(getLaunchFeedCatalog(), seriesSlug, episodeSlug, {
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
  const description = copy.hook.replace(/\n/g, " ");
  const path = watchPath(resolved);
  return {
    title: item.seriesTitle,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: item.seriesTitle,
      description,
      url: path,
      images: [{ url: item.thumbnailUrl }],
    },
  };
}

export default async function WatchPage({ params }: WatchPageProps) {
  const resolved = await params;
  const item = findPublished(resolved);
  if (!item) notFound();
  preload(item.thumbnailUrl, { as: "image", fetchPriority: "high" });

  return <FeedApp initialContentId={item.id} deepLinkRoute={watchPath(resolved)} />;
}
