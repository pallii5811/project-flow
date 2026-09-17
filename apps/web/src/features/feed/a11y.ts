/**
 * Keyboard, screen reader and focus decisions of the feed (batch 3b), pure so
 * they are tested without a browser.
 */
import type { IntentChipId } from "@project-flow/feed-domain";

/* ---------- The global key handler (A11Y-02) ---------- */

export type FeedKeyAction =
  "next" | "previous" | "toggle_play" | "toggle_mute" | "toggle_captions";

export type FeedKeyInput = {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  /** A modal sheet is open: the feed behind it takes no keys at all. */
  dialogOpen: boolean;
  /** The key was pressed inside a dialog. */
  inDialog: boolean;
  /** Focus is in a text field: every key is typing. */
  inTextField: boolean;
  /** Focus is on a button or a link: Space and Enter activate it. */
  onControl: boolean;
};

/**
 * What a key press does to the feed, or null when it belongs to someone else.
 * Space on a focused button presses that button, never play/pause; the arrow
 * keys still move between episodes from a rail button, since a button does
 * nothing with them.
 */
export function feedKeyAction(input: FeedKeyInput): FeedKeyAction | null {
  if (input.defaultPrevented) return null;
  if (input.ctrlKey || input.metaKey || input.altKey) return null;
  if (input.dialogOpen || input.inDialog || input.inTextField) return null;
  switch (input.key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "previous";
    case "m":
    case "M":
      return "toggle_mute";
    case "c":
    case "C":
      return "toggle_captions";
    default:
      break;
  }
  if (input.key === " " || input.code === "Space") {
    return input.onControl ? null : "toggle_play";
  }
  return null;
}

/* ---------- The Tune sheet as a dialog (A11Y-02, UX-09) ---------- */

/**
 * Where Tab goes inside a dialog of `count` focusable elements, from the one
 * at `current` (-1 when focus is not on any of them). It wraps both ways.
 */
export function trappedFocusIndex(
  count: number,
  current: number,
  backwards: boolean,
): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  if (backwards) return current === 0 ? count - 1 : current - 1;
  return current === count - 1 ? 0 : current + 1;
}

const INTENT_CONFIRMATIONS: Record<IntentChipId, string> = {
  MORE_LIKE_THIS: "More like this is up next",
  MORE_ROMANCE: "More romance is up next",
  DARKER: "Darker stories are up next",
  MORE_REVENGE: "More revenge is up next",
  STRONG_FEMALE_LEAD: "Stronger female leads are up next",
  SURPRISE_ME: "A surprise is up next",
};

/**
 * The words shown after a chip: the feed really was reordered only when the
 * catalog had candidates, and the notice never claims otherwise.
 */
export function intentConfirmation(chipId: IntentChipId, candidates: number): string {
  return candidates > 0 ? INTENT_CONFIRMATIONS[chipId] : "Nothing new for that yet";
}

/* ---------- Episode changes for screen readers (A11Y-07) ---------- */

/** "Signal Night, Episode 2 of 5": the name of a slide and what is announced. */
export function episodeAnnouncement(seriesTitle: string, positionLabel: string): string {
  return `${seriesTitle}, ${positionLabel}`;
}

/**
 * Announce only a change the viewer made: never the episode the page opened
 * on (the page itself is read), never the same episode twice.
 */
export function shouldAnnounceEpisode(
  previousId: string | null,
  currentId: string | null,
): boolean {
  return previousId !== null && currentId !== null && previousId !== currentId;
}

/**
 * Focus follows the episode only when it was last in the feed: a rail button
 * of the old slide is gone, so focus would otherwise fall back to the page.
 * `now` is where focus is at the change; focus that moved somewhere else (a
 * sheet, the notice link) is left alone.
 */
export function shouldMoveFocusToSlide(
  lastFocusInFeed: boolean,
  now: "feed" | "page" | "elsewhere",
): boolean {
  return lastFocusInFeed && now !== "elsewhere";
}
