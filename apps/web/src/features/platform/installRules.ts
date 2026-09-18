/**
 * When the invitation to install the app may appear, and to whom. Pure, so
 * every rule is pinned by installRules.test.ts.
 *
 * The rules (docs/decisions.md, batch 5):
 * - never before real engagement: two episodes watched to the end in this
 *   visit, and at least a minute since the page opened;
 * - never over something else: a sheet, the end of a series, a notice, a
 *   landscape phone whose frame is too narrow for the card;
 * - shown once per browser, whatever the answer. Dismissed, ignored or
 *   accepted, it never comes back;
 * - never to someone already in the installed app;
 * - on iOS Safari it is a hint (Share, then Add to Home Screen): Safari has no
 *   install prompt and never says whether the viewer followed it, so no event
 *   claims an install there.
 */

/** "prompt": the browser can install on a tap (Chrome, Edge, Samsung Internet). "ios": Safari's manual route. */
export type InstallPlatform = "prompt" | "ios";

export const INSTALL_STORAGE_KEY = "project-flow.install.v1";
/** Episodes watched to their end in this visit before the invitation. */
export const INSTALL_OFFER_EPISODES = 2;
/** Never in the first minute of a visit. */
export const INSTALL_OFFER_MIN_VISIT_MS = 60_000;
/** After the episode ends, the next one gets its first seconds to itself. */
export const INSTALL_OFFER_DELAY_MS = 4_000;
/** Unanswered, the card leaves by itself: that counts as its one showing. */
export const INSTALL_OFFER_VISIBLE_MS = 12_000;

export type InstallRecord = {
  /** When the invitation was shown; it is never shown again. */
  offeredAt: number | null;
  /** The browser reported the app installed (appinstalled). */
  installed: boolean;
};

export const EMPTY_INSTALL_RECORD: InstallRecord = { offeredAt: null, installed: false };

export function parseInstallRecord(raw: string | null): InstallRecord {
  if (!raw) return EMPTY_INSTALL_RECORD;
  try {
    const parsed = JSON.parse(raw) as Partial<InstallRecord>;
    return {
      offeredAt: typeof parsed.offeredAt === "number" ? parsed.offeredAt : null,
      installed: parsed.installed === true,
    };
  } catch {
    // Unreadable means we cannot know it was not shown: stay quiet.
    return { offeredAt: 0, installed: false };
  }
}

export function serializeInstallRecord(record: InstallRecord): string {
  return JSON.stringify(record);
}

/**
 * iOS and iPadOS Safari, the only browser there that can add to the Home
 * Screen from its share sheet. In-app browsers (Instagram, Facebook, TikTok)
 * cannot, and Chrome or Firefox on iOS name themselves in the user agent.
 */
export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!ios) return false;
  if (!/Safari\//.test(userAgent)) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|TikTok|musical_ly|Line\//.test(
    userAgent,
  );
}

export function installPlatform(input: {
  standalone: boolean;
  /** The browser handed us its install prompt (beforeinstallprompt). */
  hasPrompt: boolean;
  userAgent: string;
  maxTouchPoints: number;
}): InstallPlatform | null {
  if (input.standalone) return null;
  if (input.hasPrompt) return "prompt";
  if (isIosSafari(input.userAgent, input.maxTouchPoints)) return "ios";
  return null;
}

export function installOfferDue(input: {
  platform: InstallPlatform | null;
  record: InstallRecord;
  episodesFinished: number;
  visitMs: number;
  /** Something else is on screen, or the frame is too narrow for the card. */
  blocked: boolean;
}): boolean {
  if (input.platform === null) return false;
  if (input.record.installed || input.record.offeredAt !== null) return false;
  if (input.blocked) return false;
  if (input.episodesFinished < INSTALL_OFFER_EPISODES) return false;
  return input.visitMs >= INSTALL_OFFER_MIN_VISIT_MS;
}

export type InstallOutcome =
  /** The browser's own install dialog was accepted. */
  | "accepted"
  /** Install tapped, then the browser's dialog was cancelled. */
  | "declined_in_browser"
  /** "Not now". */
  | "dismissed"
  /** iOS "Got it": the hint was read. Not an install. */
  | "acknowledged"
  /** Nobody answered before the card left. */
  | "ignored";

/** How the page is running: in a browser tab or as the installed app. */
export function displayMode(matches: (query: string) => boolean, iosStandalone: boolean): string {
  if (iosStandalone || matches("(display-mode: standalone)")) return "standalone";
  if (matches("(display-mode: fullscreen)")) return "fullscreen";
  if (matches("(display-mode: minimal-ui)")) return "minimal-ui";
  return "browser";
}
