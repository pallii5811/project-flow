import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getLaunchFeedCatalog } from "@project-flow/feed-domain";
import { describe, expect, it } from "vitest";

import { notFoundStory } from "../../lib/notFoundStory";
import {
  episodeAnnouncement,
  feedKeyAction,
  intentConfirmation,
  shouldAnnounceEpisode,
  shouldMoveFocusToSlide,
  trappedFocusIndex,
  type FeedKeyInput,
} from "./a11y";
import { contrastRatio } from "./storyThread";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const feedCss = read("./feed.module.css");
const block = (css: string, selector: string) =>
  new RegExp(`${selector.replace(/[.[\]"=]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`).exec(
    css,
  )?.[1] ?? "";
const hex = (value: string): [number, number, number] =>
  [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
/** a over b, each channel. */
const over = (
  top: readonly [number, number, number],
  alpha: number,
  bottom: readonly [number, number, number],
): [number, number, number] =>
  [0, 1, 2].map((i) => top[i]! * alpha + bottom[i]! * (1 - alpha)) as [
    number,
    number,
    number,
  ];

const key = (overrides: Partial<FeedKeyInput>): FeedKeyInput => ({
  key: "",
  dialogOpen: false,
  inDialog: false,
  inTextField: false,
  onControl: false,
  ...overrides,
});

describe("global keys (A11Y-02)", () => {
  it("drive the feed from the page", () => {
    expect(feedKeyAction(key({ key: "ArrowDown" }))).toBe("next");
    expect(feedKeyAction(key({ key: "ArrowUp" }))).toBe("previous");
    expect(feedKeyAction(key({ key: " ", code: "Space" }))).toBe("toggle_play");
    expect(feedKeyAction(key({ key: "M" }))).toBe("toggle_mute");
    expect(feedKeyAction(key({ key: "c" }))).toBe("toggle_captions");
  });

  it("leave Space to a focused button or link", () => {
    expect(feedKeyAction(key({ key: " ", code: "Space", onControl: true }))).toBeNull();
    // A button does nothing with the arrows: they still move between episodes.
    expect(feedKeyAction(key({ key: "ArrowDown", onControl: true }))).toBe("next");
  });

  it("take nothing while a dialog is open, inside a dialog or a text field", () => {
    for (const where of [
      { dialogOpen: true },
      { inDialog: true },
      { inTextField: true },
    ]) {
      for (const name of ["ArrowDown", "ArrowUp", " ", "m", "c"]) {
        expect(feedKeyAction(key({ key: name, ...where }))).toBeNull();
      }
    }
  });

  it("ignore shortcuts of the browser and keys already handled", () => {
    expect(feedKeyAction(key({ key: "c", ctrlKey: true }))).toBeNull();
    expect(feedKeyAction(key({ key: "ArrowDown", altKey: true }))).toBeNull();
    expect(feedKeyAction(key({ key: "m", metaKey: true }))).toBeNull();
    expect(feedKeyAction(key({ key: "ArrowDown", defaultPrevented: true }))).toBeNull();
  });
});

describe("the Tune sheet (A11Y-02, UX-09)", () => {
  it("keeps Tab inside, wrapping both ways", () => {
    expect(trappedFocusIndex(3, 0, false)).toBe(1);
    expect(trappedFocusIndex(3, 2, false)).toBe(0);
    expect(trappedFocusIndex(3, 0, true)).toBe(2);
    expect(trappedFocusIndex(3, -1, false)).toBe(0);
    expect(trappedFocusIndex(3, -1, true)).toBe(2);
    expect(trappedFocusIndex(0, -1, false)).toBe(-1);
  });

  it("confirms a choice only when the feed really changed", () => {
    expect(intentConfirmation("DARKER", 8)).toBe("Darker stories are up next");
    expect(intentConfirmation("DARKER", 0)).toBe("Nothing new for that yet");
  });

  it("has a title that reads at AA on the sheet", () => {
    const title = /color:\s*#([0-9a-f]{6})/i.exec(block(feedCss, ".sheetTitle"))?.[1];
    const sheet = /background:\s*#([0-9a-f]{6})/i.exec(block(feedCss, ".sheet"))?.[1];
    expect(title).toBeDefined();
    expect(sheet).toBeDefined();
    expect(contrastRatio(hex(title!), hex(sheet!))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("episode changes for screen readers (A11Y-07)", () => {
  it("name the slide and announce only a change", () => {
    expect(episodeAnnouncement("Signal Night", "Episode 2 of 5")).toBe(
      "Signal Night, Episode 2 of 5",
    );
    expect(shouldAnnounceEpisode(null, "a")).toBe(false);
    expect(shouldAnnounceEpisode("a", "a")).toBe(false);
    expect(shouldAnnounceEpisode("a", "b")).toBe(true);
  });

  it("move focus with the episode only when it was in the feed", () => {
    expect(shouldMoveFocusToSlide(true, "page")).toBe(true);
    expect(shouldMoveFocusToSlide(true, "feed")).toBe(true);
    expect(shouldMoveFocusToSlide(true, "elsewhere")).toBe(false);
    expect(shouldMoveFocusToSlide(false, "page")).toBe(false);
  });
});

describe("contrast of small text over any frame (A11Y-06)", () => {
  const white: [number, number, number] = [255, 255, 255];

  it("the episode position keeps 4.5:1 over a white frame where the scrim is thinnest under it", () => {
    const kicker = /color:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(
      block(feedCss, ".episodeKicker"),
    );
    // The position sits in the lower 45% of the scrim with a title and a
    // hook of up to three lines under it; 45% is the scrim's middle stop.
    const middleStop = /rgba\(0,\s*0,\s*0,\s*([\d.]+)\)\s*45%/.exec(
      block(feedCss, ".scrimBottom"),
    );
    expect(kicker).not.toBeNull();
    expect(middleStop).not.toBeNull();
    const backdrop = over([0, 0, 0], Number(middleStop![1]), white);
    const text = over(
      [Number(kicker![1]), Number(kicker![2]), Number(kicker![3])],
      Number(kicker![4]),
      backdrop,
    );
    expect(contrastRatio(text, backdrop)).toBeGreaterThanOrEqual(4.5);
  });

  it("the playback error keeps 4.5:1 over a white poster", () => {
    const shade = /background:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(
      block(feedCss, ".mediaFail"),
    );
    const words = /color:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(
      block(feedCss, ".mediaFailText"),
    );
    expect(shade).not.toBeNull();
    expect(words).not.toBeNull();
    const backdrop = over(
      [Number(shade![1]), Number(shade![2]), Number(shade![3])],
      Number(shade![4]),
      white,
    );
    const text = over(
      [Number(words![1]), Number(words![2]), Number(words![3])],
      Number(words![4]),
      backdrop,
    );
    expect(contrastRatio(text, backdrop)).toBeGreaterThanOrEqual(4.5);
  });

  it("neighbouring slides are not dimmed", () => {
    expect(feedCss).not.toMatch(/\.overlayInactive/);
  });
});

describe("layout rules (A11Y-03, A11Y-05)", () => {
  it("a phone in landscape gets the uncropped 9:16 frame whatever its width", () => {
    const rule =
      /@media \(orientation: landscape\) and \(max-height: 480px\)\s*\{([\s\S]*?)\n\}/.exec(
        feedCss,
      )?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/width:\s*calc\(100dvh \* 9 \/ 16\)/);
    expect(feedCss).not.toMatch(/@media \(min-width: 768px\) and \(max-height: 480px\)/);
  });

  it("safe-area insets are never added to the body around a 100dvh feed", () => {
    const globals = read("../../app/globals.css");
    expect(globals).not.toMatch(/env\(safe-area-inset/);
    expect(block(feedCss, ".root")).toMatch(/height:\s*100dvh/);
  });
});

describe("the page for an unknown URL (UX-10)", () => {
  it("offers the story the feed opens on, from its episode page", () => {
    const story = notFoundStory(getLaunchFeedCatalog());
    expect(story).not.toBeNull();
    expect(story!.href).toMatch(/^\/watch\/[a-z0-9-]+\/episode-\d+$/);
    expect(story!.seriesTitle.length).toBeGreaterThan(0);
    expect(story!.hook).not.toContain("\n");
  });

  it("offers nothing to tap when nothing can play", () => {
    expect(notFoundStory({ series: [], items: [] })).toBeNull();
  });
});
