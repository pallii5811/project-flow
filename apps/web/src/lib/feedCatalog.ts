import {
  getLaunchFeedCatalog,
  parseStressEpisodeCount,
  withStressEpisodes,
  type FeedCatalog,
} from "@project-flow/feed-domain";

let cached: FeedCatalog | null = null;

/**
 * The catalog the static export is built from. Build-time only: pages, the
 * catalog JSON route and generateStaticParams call it; the browser never
 * does. FLOW_STRESS_EPISODES multiplies the stand-in pack for scale tests
 * (scripts/build-stress.mjs) and is never set for a real build.
 */
export function getWebFeedCatalog(): FeedCatalog {
  cached ??= withStressEpisodes(
    getLaunchFeedCatalog(),
    parseStressEpisodeCount(process.env.FLOW_STRESS_EPISODES),
  );
  return cached;
}
