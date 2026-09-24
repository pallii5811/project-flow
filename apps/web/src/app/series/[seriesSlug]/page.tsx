import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { seriesPageData, seriesPageSlugs } from "@project-flow/feed-domain";

import { SeriesView } from "@/features/series/SeriesView";
import { getWebFeedCatalog } from "@/lib/feedCatalog";
import { seriesPath } from "@/lib/promise";
import { seriesMetadata } from "@/lib/siteMetadata";

type SeriesParams = { seriesSlug: string };
type SeriesPageProps = { params: Promise<SeriesParams> };

/**
 * One static HTML file per published series, like the episode pages: the
 * address a clip sends a stranger to, and the page search engines index once
 * the beta opens. Everything on it is derived from the catalog at BUILD time,
 * so an episode list can never disagree with what plays.
 */
export const dynamicParams = false;

export function generateStaticParams(): SeriesParams[] {
  return seriesPageSlugs(getWebFeedCatalog()).map((seriesSlug) => ({ seriesSlug }));
}

export async function generateMetadata({ params }: SeriesPageProps): Promise<Metadata> {
  const { seriesSlug } = await params;
  const data = seriesPageData(getWebFeedCatalog(), seriesSlug);
  if (!data) {
    return { title: "Not found", description: "This series is unavailable." };
  }
  return seriesMetadata(
    {
      title: data.title,
      hook: data.hook,
      episodeCount: data.episodes.length,
      shareCardUrl: data.shareCardUrl,
    },
    seriesPath(data.seriesSlug),
  );
}

export default async function SeriesPage({ params }: SeriesPageProps) {
  const { seriesSlug } = await params;
  const data = seriesPageData(getWebFeedCatalog(), seriesSlug);
  if (!data) notFound();
  return <SeriesView data={data} />;
}
