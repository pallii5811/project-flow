import type { Metadata } from "next";
import Link from "next/link";

import {
  LAUNCH_CATALOG,
  findBySlugs,
  resolveDisplayCopy,
} from "@project-flow/feed-domain";

import { FeedApp } from "@/features/feed/FeedApp";

type WatchPageProps = {
  params: Promise<{
    seriesSlug: string;
    episodeSlug: string;
  }>;
};

export async function generateMetadata({
  params,
}: WatchPageProps): Promise<Metadata> {
  const { seriesSlug, episodeSlug } = await params;
  const item = findBySlugs(LAUNCH_CATALOG, seriesSlug, episodeSlug, {
    publishedOnly: true,
  });
  if (!item) {
    return {
      title: "Not found",
      description: "This episode is unavailable.",
    };
  }
  const copy = resolveDisplayCopy(item, "en");
  return {
    title: item.seriesTitle,
    description: copy.hook.replace(/\n/g, " "),
    openGraph: {
      title: item.seriesTitle,
      description: copy.hook.replace(/\n/g, " "),
      images: [{ url: item.thumbnailUrl }],
    },
  };
}

export default async function WatchPage({ params }: WatchPageProps) {
  const { seriesSlug, episodeSlug } = await params;
  const item = findBySlugs(LAUNCH_CATALOG, seriesSlug, episodeSlug, {
    publishedOnly: true,
  });

  if (!item) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          textAlign: "center",
          background: "#0B0B0C",
          color: "#F4F3F1",
        }}
      >
        <div>
          <p style={{ margin: "0 0 12px", opacity: 0.72 }}>
            This episode is unavailable.
          </p>
          <Link href="/" style={{ textDecoration: "underline" }}>
            Back to feed
          </Link>
        </div>
      </main>
    );
  }

  return (
    <FeedApp
      initialContentId={item.id}
      deepLinkRoute={`/watch/${seriesSlug}/${episodeSlug}`}
    />
  );
}
