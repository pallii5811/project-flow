import type { ContentItem, FeedCatalog } from "@project-flow/feed-domain";
import { watchPathForItem } from "@project-flow/feed-domain";

export type ShareUrlOptions = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  shareId?: string;
};

/** Absolute share URL with attribution query params. */
export function buildShareUrl(
  catalog: FeedCatalog,
  item: ContentItem,
  origin: string,
  options: ShareUrlOptions = {},
): string | null {
  const path = watchPathForItem(catalog, item);
  if (!path) return null;
  const base = origin.replace(/\/$/, "");
  const url = new URL(`${base}${path}`);
  url.searchParams.set("utm_source", options.utmSource ?? "share");
  url.searchParams.set("utm_medium", options.utmMedium ?? "social");
  if (options.utmCampaign) {
    url.searchParams.set("utm_campaign", options.utmCampaign);
  }
  if (options.shareId) {
    url.searchParams.set("share_id", options.shareId);
  }
  return url.toString();
}

/** Whether the PlayGate should show (autoplay blocked and not yet user-started). */
export function shouldShowPlayGate(
  autoplayBlocked: boolean,
  userStartedPlayback: boolean,
): boolean {
  return autoplayBlocked && !userStartedPlayback;
}
