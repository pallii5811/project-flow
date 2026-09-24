import type { Metadata } from "next";

import { browseCatalog, browseGenres } from "@project-flow/feed-domain";

import { StoriesView } from "@/features/series/StoriesView";
import { BRAND_NAME } from "@/lib/brand";
import { getWebFeedCatalog } from "@/lib/feedCatalog";
import { BROWSE_PATH, FREE_FOREVER_LINE } from "@/lib/promise";
import { plainPageMetadata } from "@/lib/siteMetadata";

/**
 * Everything we have, by genre. Not a catalogue app: one page, reachable from
 * the end of a story and from a series page, never from the first screen —
 * nothing may come between a link and a picture (AGENTS.md, non-negotiables).
 */
export const metadata: Metadata = plainPageMetadata(
  "Every story",
  `Every series on ${BRAND_NAME}, by genre. ${FREE_FOREVER_LINE}`,
  BROWSE_PATH,
);

export default function StoriesPage() {
  const series = browseCatalog(getWebFeedCatalog());
  return <StoriesView series={series} genres={browseGenres(series)} />;
}
