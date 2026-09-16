import type { CaptionTrack } from "../model/types";

/**
 * Pick a caption track: requested locale → base language → default track → first ready.
 */
export function selectCaptionTrack(
  tracks: CaptionTrack[],
  requestedLocale?: string | null,
): CaptionTrack | null {
  const ready = tracks.filter((t) => t.status === "ready");
  if (ready.length === 0) return null;
  if (requestedLocale) {
    const exact = ready.find((t) => t.language === requestedLocale);
    if (exact) return exact;
    const base = requestedLocale.split("-")[0];
    if (base) {
      const baseMatch = ready.find((t) => t.language === base || t.language.startsWith(`${base}-`));
      if (baseMatch) return baseMatch;
    }
  }
  return ready.find((t) => t.default) ?? ready[0] ?? null;
}
