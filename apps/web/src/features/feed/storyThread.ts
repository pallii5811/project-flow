/**
 * The first seconds and the thread of the story (batch 3a): captions while
 * muted, the one-time sound cue, timestamped shares, the episode position and
 * the handoff at the end of a series. Pure decisions, tested in
 * storyThread.test.ts; the components only render them.
 */
import type { ContentItem } from "@project-flow/feed-domain";

/* ---------- Captions (DECISIONI.md decision 3) ---------- */

/** The viewer's explicit caption choice, the same for every series. */
export const CAPTIONS_PREFERENCE_KEY = "project-flow.captions.v1";

/** null: the viewer never chose, so captions follow the sound. */
export type CaptionChoice = boolean | null;

/**
 * Captions on screen: the explicit choice when there is one; otherwise on
 * while muted (most first opens are silent) and off once the sound is on.
 */
export function effectiveCaptions(
  choice: CaptionChoice,
  muted: boolean,
  available: boolean,
): boolean {
  if (!available) return false;
  return choice ?? muted;
}

/** Reads a stored choice. Anything unexpected is no choice, never "off". */
export function parseCaptionChoice(raw: string | null): CaptionChoice {
  if (raw === "on") return true;
  if (raw === "off") return false;
  return null;
}

export function serializeCaptionChoice(choice: boolean): "on" | "off" {
  return choice ? "on" : "off";
}

/**
 * Before this preference existed, captions were off by default and only a
 * toggle turned them on, so a resume point saved with captions on records a
 * choice. Saved off records nothing: it was the default.
 */
export function migratedCaptionChoice(
  stored: CaptionChoice,
  legacyResumeCaptionsOn: boolean | null,
): CaptionChoice {
  if (stored !== null) return stored;
  return legacyResumeCaptionsOn === true ? true : null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lrm: "",
  rlm: "",
};

/**
 * Plain text of a WebVTT cue payload: voice, class and style tags removed,
 * entities decoded, lines kept. Nothing is rendered as HTML.
 */
export function cuePlainText(payload: string): string {
  return payload
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (match, name: string) => {
      if (name.startsWith("#")) {
        const code = Number(name.slice(1));
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
      }
      return NAMED_ENTITIES[name.toLowerCase()] ?? match;
    })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Joins the cues active at once (overlapping speakers), in cue order. */
export function activeCueText(payloads: readonly string[]): string | null {
  const text = payloads
    .map(cuePlainText)
    .filter((entry) => entry.length > 0)
    .join("\n");
  return text.length > 0 ? text : null;
}

/** sRGB relative luminance (WCAG 2.x). */
export function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Worst case for light text on a translucent dark backdrop: the video behind
 * it is pure white, so the composited backdrop is at its brightest.
 */
export function worstCaseCaptionContrast(
  text: readonly [number, number, number],
  backdrop: readonly [number, number, number],
  backdropAlpha: number,
): number {
  const over = (channel: number) => channel * backdropAlpha + 255 * (1 - backdropAlpha);
  return contrastRatio(text, [over(backdrop[0]), over(backdrop[1]), over(backdrop[2])]);
}

/* ---------- The sound cue ---------- */

/** The cue stays this long at most; the first tap removes it sooner. */
export const SOUND_CUE_VISIBLE_MS = 4_000;
/** Shown once per browser session, never again after a reload. */
export const SOUND_CUE_SESSION_KEY = "project-flow.sound-cue.v1";

export function shouldShowSoundCue(input: {
  muted: boolean;
  /** A frame of the active episode is on screen. */
  playing: boolean;
  alreadyShown: boolean;
  /** The tap-to-play gate, an error, a sheet or a card owns the screen. */
  blocked: boolean;
}): boolean {
  return input.muted && input.playing && !input.alreadyShown && !input.blocked;
}

/* ---------- Timestamped share (OPP-02) ---------- */

/** The receiver starts this much before the shared moment, to catch the line. */
export const SHARE_PREROLL_MS = 3_000;
/** Shared this early, the link simply opens the episode at its start. */
export const SHARE_MIN_POSITION_MS = 5_000;
/** Shared in the last seconds: the link opens at the start, not on the credits. */
export const SHARE_END_MARGIN_MS = 2_000;

/** The `t` (whole seconds) a share carries, or null to open at the start. */
export function shareStartSeconds(positionMs: number, durationMs: number): number | null {
  if (!Number.isFinite(positionMs) || positionMs < SHARE_MIN_POSITION_MS) return null;
  if (
    Number.isFinite(durationMs) &&
    durationMs > 0 &&
    positionMs > durationMs - SHARE_END_MARGIN_MS
  ) {
    return null;
  }
  return Math.floor((positionMs - SHARE_PREROLL_MS) / 1_000);
}

/**
 * The start a landing reads from `?t=`: whole positive seconds inside the
 * episode, else null. A malformed value opens the episode at its start.
 */
export function parseShareStartMs(search: string, durationMs: number): number | null {
  const raw = new URLSearchParams(search).get("t");
  if (raw === null || !/^\d{1,5}$/.test(raw)) return null;
  const ms = Number(raw) * 1_000;
  if (ms <= 0) return null;
  if (durationMs > 0 && ms >= durationMs - SHARE_END_MARGIN_MS) return null;
  return ms;
}

/* ---------- Episode position (UX-07) ---------- */

export function episodePosition(
  episodeNumber: number,
  episodeCount: number | null,
): { text: string; label: string } {
  if (episodeCount === null || episodeCount < episodeNumber || episodeCount <= 0) {
    return { text: `Episode ${episodeNumber}`, label: `Episode ${episodeNumber}` };
  }
  return {
    text: `Episode ${episodeNumber} / ${episodeCount}`,
    label: `Episode ${episodeNumber} of ${episodeCount}`,
  };
}

/* ---------- The end of a series (UX-06, VIR-7) ---------- */

/**
 * The story offered when a series ends: the next other series in the feed
 * order the viewer already has (recommended), opened at its first episode
 * when that exists; otherwise the first other series of the catalog. Never
 * the series that just ended. Null when there is no other story.
 */
export function pickNextStory(
  items: readonly ContentItem[],
  index: number,
  ordered: readonly ContentItem[],
): ContentItem | null {
  const current = items[index];
  if (!current) return null;
  const firstEpisodeOf = (seriesId: string): ContentItem | null =>
    ordered.find((item) => item.seriesId === seriesId && item.episodeNumber === 1) ??
    null;

  const listed = items
    .slice(index + 1)
    .find((item) => item.seriesId !== current.seriesId);
  if (listed) return firstEpisodeOf(listed.seriesId) ?? listed;
  const fromCatalog = ordered.find((item) => item.seriesId !== current.seriesId);
  if (!fromCatalog) return null;
  return firstEpisodeOf(fromCatalog.seriesId) ?? fromCatalog;
}

/**
 * Where the next story goes in the list: where it already is, or right after
 * the episode on screen (the same rule as a missing next episode).
 */
export function placeStory(
  items: readonly ContentItem[],
  index: number,
  story: ContentItem,
): { items: ContentItem[]; index: number } {
  const found = items.findIndex((item) => item.id === story.id);
  if (found > index) return { items: [...items], index: found };
  // Listed earlier (already passed) or not listed: it moves right after the
  // episode on screen, so it is never listed twice.
  const rest = items.filter((item) => item.id !== story.id);
  const currentId = items[index]?.id;
  const at = rest.findIndex((item) => item.id === currentId) + 1;
  return { items: [...rest.slice(0, at), story, ...rest.slice(at)], index: at };
}

/** The episode a "share this story" link opens: the first of the series. */
export function storyShareTarget(
  item: ContentItem,
  ordered: readonly ContentItem[],
): ContentItem {
  return (
    ordered.find(
      (entry) => entry.seriesId === item.seriesId && entry.episodeNumber === 1,
    ) ?? item
  );
}
