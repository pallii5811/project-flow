"use client";

import type { AnalyticsClient } from "@project-flow/analytics";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  INSTALL_OFFER_DELAY_MS,
  INSTALL_OFFER_VISIBLE_MS,
  INSTALL_STORAGE_KEY,
  displayMode,
  installOfferDue,
  installPlatform,
  parseInstallRecord,
  serializeInstallRecord,
  type InstallOutcome,
  type InstallPlatform,
  type InstallRecord,
} from "./installRules";

/** Chrome's install prompt: not in the DOM typings. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * The browser may hand over its install prompt before React has hydrated.
 * Caught here, at module load, it is kept for later instead of letting the
 * browser show its own banner over the first seconds of the story.
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    for (const listener of promptListeners) listener();
  });
}

function readRecord(): InstallRecord {
  try {
    return parseInstallRecord(window.localStorage.getItem(INSTALL_STORAGE_KEY));
  } catch {
    return parseInstallRecord("unreadable");
  }
}

function writeRecord(record: InstallRecord): void {
  try {
    window.localStorage.setItem(INSTALL_STORAGE_KEY, serializeInstallRecord(record));
  } catch {
    // Private mode: the card may come back next visit, never twice in one.
  }
}

function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    displayMode((query) => window.matchMedia(query).matches, nav.standalone === true) !==
    "browser"
  );
}

/** The frame of a phone in landscape is too narrow for the card (feed.module.css). */
function frameTooNarrow(): boolean {
  return window.matchMedia("(orientation: landscape) and (max-height: 480px)").matches;
}

export type InstallOfferControls = {
  /** What to show now, or null. */
  offer: InstallPlatform | null;
  /** An episode was watched to its end. */
  episodeFinished: () => void;
  accept: () => void;
  dismiss: () => void;
};

export function useInstallOffer(
  analytics: AnalyticsClient,
  blocked: boolean,
): InstallOfferControls {
  const [offer, setOffer] = useState<InstallPlatform | null>(null);
  const [hasPrompt, setHasPrompt] = useState(false);
  const [pending, setPending] = useState(false);
  const episodes = useRef(0);
  const shown = useRef(false);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    const sync = () => setHasPrompt(deferredPrompt !== null);
    sync();
    promptListeners.add(sync);
    const onInstalled = () => {
      writeRecord({ ...readRecord(), installed: true });
      analytics.track("app_installed", {});
      setOffer(null);
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      promptListeners.delete(sync);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [analytics]);

  const close = useCallback(
    (platform: InstallPlatform, outcome: InstallOutcome) => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
      setOffer(null);
      analytics.track("install_offer_answered", { platform, outcome });
    },
    [analytics],
  );

  // An episode ended: the next one plays its first seconds, then, if the
  // visit has earned it, the card may appear.
  useEffect(() => {
    if (!pending || blocked || shown.current) return;
    const timer = window.setTimeout(() => {
      setPending(false);
      const platform = installPlatform({
        standalone: isStandalone(),
        hasPrompt,
        userAgent: window.navigator.userAgent,
        maxTouchPoints: window.navigator.maxTouchPoints ?? 0,
      });
      const record = readRecord();
      const visitMs = performance.now();
      if (
        !installOfferDue({
          platform,
          record,
          episodesFinished: episodes.current,
          visitMs,
          blocked: frameTooNarrow(),
        }) ||
        platform === null
      ) {
        return;
      }
      shown.current = true;
      writeRecord({ ...record, offeredAt: Date.now() });
      setOffer(platform);
      analytics.track("install_offer_shown", {
        platform,
        episodes_finished: episodes.current,
        visit_seconds: Math.round(visitMs / 1000),
      });
      // Its time on screen is counted by the effect below.
    }, INSTALL_OFFER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [analytics, blocked, close, hasPrompt, pending]);

  // Something else took the screen while the card was up (a sheet, a notice,
  // the end of the series): the card hides with it, and its time on screen
  // starts again when it comes back. A card nobody could see is not "ignored".
  useEffect(() => {
    if (offer === null) return;
    if (blocked) {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
      return;
    }
    if (hideTimer.current === null) {
      const platform = offer;
      hideTimer.current = window.setTimeout(
        () => close(platform, "ignored"),
        INSTALL_OFFER_VISIBLE_MS,
      );
    }
  }, [blocked, close, offer]);

  useEffect(
    () => () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const episodeFinished = useCallback(() => {
    episodes.current += 1;
    if (!shown.current) setPending(true);
  }, []);

  const accept = useCallback(() => {
    const platform = offer;
    if (!platform) return;
    if (platform === "ios") {
      close("ios", "acknowledged");
      return;
    }
    const prompt = deferredPrompt;
    deferredPrompt = null;
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setOffer(null);
    if (!prompt) {
      analytics.track("install_offer_answered", { platform, outcome: "declined_in_browser" });
      return;
    }
    void prompt
      .prompt()
      .then(() => prompt.userChoice)
      .then((choice) => {
        analytics.track("install_offer_answered", {
          platform,
          outcome: choice.outcome === "accepted" ? "accepted" : "declined_in_browser",
        });
      })
      .catch(() => {
        analytics.track("install_offer_answered", { platform, outcome: "declined_in_browser" });
      });
  }, [analytics, close, offer]);

  const dismiss = useCallback(() => {
    if (offer) close(offer, "dismissed");
  }, [close, offer]);

  return { offer, episodeFinished, accept, dismiss };
}
