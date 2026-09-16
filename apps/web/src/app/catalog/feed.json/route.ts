import { toFeedCatalogPayload } from "@project-flow/feed-domain";

import { getWebFeedCatalog } from "@/lib/feedCatalog";

/**
 * The feed catalog as a static file (out/catalog/feed.json), generated at
 * build time. The browser fetches it after the first episode is playing; the
 * JavaScript bundle never contains the catalog (speed-2).
 */
export const dynamic = "force-static";

export function GET(): Response {
  return Response.json(toFeedCatalogPayload(getWebFeedCatalog()));
}
