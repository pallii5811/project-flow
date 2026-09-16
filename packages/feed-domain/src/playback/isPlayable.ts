import type { ContentItem } from "../model/types";

export function isPlayableItem(item: ContentItem, now = Date.now()): boolean {
  if (item.status !== "published") return false;
  if (!item.videoUrl.trim() && !item.playback.reference.trim()) return false;
  if (item.playback.expiresAt) {
    const expires = Date.parse(item.playback.expiresAt);
    if (Number.isFinite(expires) && expires <= now) return false;
  }
  return true;
}
