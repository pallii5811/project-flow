import { getLaunchFeedCatalog } from "@project-flow/feed-domain";
import { preload } from "react-dom";

import { FeedApp } from "@/features/feed/FeedApp";

export default function HomePage() {
  // Warm the poster of the episode that opens first — taken from the catalog,
  // never hardcoded, so it follows whatever series leads the feed.
  const first = getLaunchFeedCatalog().items[0];
  if (first) preload(first.thumbnailUrl, { as: "image", fetchPriority: "high" });
  return <FeedApp />;
}
