/**
 * The one sentence that separates us from the apps a viewer has met before,
 * and the addresses of the pages that are not the feed.
 *
 * The sentence is written once, here, because it is a promise: every place
 * that says it says exactly the same thing, and a test can prove it appears
 * where it should and nowhere else (docs/standard.md §1, AGENTS.md "Forbidden
 * forever"). It is never repeated inside one surface, never shown twice in
 * the feed, and never used as a reason to interrupt playback.
 */
export const FREE_FOREVER_LINE = "Free forever. No coins, no unlocks.";

/** Everything we have, by genre. One page, no chrome in the feed. */
export const BROWSE_PATH = "/stories";

/** The page about one series: what a clip viewer opens to know what this is. */
export function seriesPath(seriesSlug: string): string {
  return `/series/${seriesSlug}`;
}

/** The page the owner links in an outreach email. */
export const FOR_STUDIOS_PATH = "/for-studios";
