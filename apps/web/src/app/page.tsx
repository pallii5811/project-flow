import { firstFramePayload } from "@project-flow/feed-domain";

import { FeedDocument } from "@/features/feed/FeedDocument";
import { getWebFeedCatalog } from "@/lib/feedCatalog";

export default function HomePage() {
  // The episode that opens first comes from the catalog, never hardcoded, so
  // it follows whatever series leads the feed. Only it and the next one are
  // in the page; the rest of the catalog is fetched after first play.
  return <FeedDocument initial={firstFramePayload(getWebFeedCatalog())} />;
}
