import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createDeterministicFeedSource,
  getLaunchFeedCatalog,
  withStressEpisodes,
} from "@project-flow/feed-domain";
import { describe, expect, it } from "vitest";

import { buildShareUrl } from "./feedLogic";
import {
  SHARE_PREROLL_MS,
  SOUND_CUE_LATEST_MS,
  activeCueText,
  contrastRatio,
  cuePlainText,
  effectiveCaptions,
  episodePosition,
  migratedCaptionChoice,
  nextCaptionChoice,
  parseCaptionChoice,
  parseShareStartMs,
  pickNextStory,
  placeStory,
  serializeCaptionChoice,
  shareStartSeconds,
  shouldHoldNotice,
  shouldShowSoundCue,
  storyShareTarget,
  worstCaseCaptionContrast,
} from "./storyThread";

describe("captions (decision 3)", () => {
  it("are on while muted and off with sound when the viewer never chose", () => {
    expect(effectiveCaptions(null, true, true)).toBe(true);
    expect(effectiveCaptions(null, false, true)).toBe(false);
  });

  it("follow the explicit choice whatever the sound does", () => {
    expect(effectiveCaptions(false, true, true)).toBe(false);
    expect(effectiveCaptions(true, false, true)).toBe(true);
  });

  it("are never on for an episode without captions", () => {
    expect(effectiveCaptions(true, true, false)).toBe(false);
    expect(effectiveCaptions(null, true, false)).toBe(false);
  });

  it("store only on/off; anything else is no choice, never off", () => {
    expect(parseCaptionChoice(serializeCaptionChoice(true))).toBe(true);
    expect(parseCaptionChoice(serializeCaptionChoice(false))).toBe(false);
    expect(parseCaptionChoice(null)).toBeNull();
    expect(parseCaptionChoice("false")).toBeNull();
    expect(parseCaptionChoice("")).toBeNull();
  });

  it("migrate a resume point saved with captions on, and nothing else", () => {
    expect(migratedCaptionChoice(null, true)).toBe(true);
    expect(migratedCaptionChoice(null, false)).toBeNull();
    expect(migratedCaptionChoice(null, null)).toBeNull();
    expect(migratedCaptionChoice(false, true)).toBe(false);
  });

  it("render cue payloads as plain text, never markup", () => {
    expect(cuePlainText("<v Mara>Do not <i>answer</i></v> the signal.")).toBe(
      "Do not answer the signal.",
    );
    expect(cuePlainText("Tom &amp; Jerry &lt;3 &#233;")).toBe(
      `Tom & Jerry <3 ${String.fromCodePoint(233)}`,
    );
    expect(cuePlainText("  first line \n\n second line ")).toBe(
      "first line\nsecond line",
    );
    expect(cuePlainText("&unknown;")).toBe("&unknown;");
  });

  it("join overlapping cues and report silence as null", () => {
    expect(activeCueText(["One.", "<v B>Two.</v>"])).toBe("One.\nTwo.");
    expect(activeCueText([])).toBeNull();
    expect(activeCueText(["<b></b>"])).toBeNull();
  });

  it("keep WCAG AA (4.5:1) over a pure white frame with the shipped styles", () => {
    const css = readFileSync(
      fileURLToPath(new URL("./feed.module.css", import.meta.url)),
      "utf8",
    );
    const block = /\.captionLine\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const color = /(?:^|\s)color:\s*#([0-9a-f]{6})/i.exec(block)?.[1];
    const background = /background:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(
      block,
    );
    expect(color).toBeDefined();
    expect(background).not.toBeNull();
    const text = [0, 2, 4].map((at) => parseInt(color!.slice(at, at + 2), 16)) as [
      number,
      number,
      number,
    ];
    const [, r, g, b, alpha] = background!;
    const ratio = worstCaseCaptionContrast(
      text,
      [Number(r), Number(g), Number(b)],
      Number(alpha),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    const fontSize = Number(/\.caption\s*\{[^}]*font-size:\s*(\d+)px/.exec(css)?.[1]);
    expect(fontSize).toBeGreaterThanOrEqual(17);
  });

  it("measures contrast like WCAG", () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2);
    // A black backdrop at 0 alpha is no backdrop: white on white.
    expect(worstCaseCaptionContrast([255, 255, 255], [0, 0, 0], 0)).toBeCloseTo(1, 5);
  });
});

describe("the sound cue", () => {
  const base = {
    muted: true,
    playing: true,
    alreadyShown: false,
    blocked: false,
    sinceFirstFrameMs: 200,
  };

  it("shows for a muted episode on screen, once", () => {
    expect(shouldShowSoundCue(base)).toBe(true);
    expect(shouldShowSoundCue({ ...base, alreadyShown: true })).toBe(false);
  });

  it("never shows with sound on, before a frame, or over another surface", () => {
    expect(shouldShowSoundCue({ ...base, muted: false })).toBe(false);
    expect(shouldShowSoundCue({ ...base, playing: false })).toBe(false);
    expect(shouldShowSoundCue({ ...base, blocked: true })).toBe(false);
    expect(shouldShowSoundCue({ ...base, sinceFirstFrameMs: null })).toBe(false);
  });

  it("does not interrupt an episode already under way when a label fades (R3A-02)", () => {
    expect(shouldShowSoundCue({ ...base, sinceFirstFrameMs: SOUND_CUE_LATEST_MS })).toBe(
      true,
    );
    expect(shouldShowSoundCue({ ...base, sinceFirstFrameMs: 3_600 })).toBe(false);
  });
});

describe("a notice the viewer is using (R3A-04)", () => {
  it("stays while the link has focus or a selection", () => {
    const failed = {
      kind: "share_failed" as const,
      focusInside: false,
      selectionInside: false,
    };
    expect(shouldHoldNotice(failed)).toBe(false);
    expect(shouldHoldNotice({ ...failed, focusInside: true })).toBe(true);
    expect(shouldHoldNotice({ ...failed, selectionInside: true })).toBe(true);
  });

  it("never holds a notice with nothing to copy", () => {
    expect(
      shouldHoldNotice({ kind: "sound", focusInside: true, selectionInside: true }),
    ).toBe(false);
    expect(
      shouldHoldNotice({
        kind: "share_copied",
        focusInside: true,
        selectionInside: true,
      }),
    ).toBe(false);
  });
});

describe("the caption toggle (R3A-03)", () => {
  it("records nothing on an episode without captions", () => {
    expect(nextCaptionChoice(null, true, false)).toBeNull();
    expect(nextCaptionChoice(true, false, false)).toBeNull();
  });

  it("flips what is on screen when captions exist", () => {
    expect(nextCaptionChoice(null, true, true)).toBe(false);
    expect(nextCaptionChoice(null, false, true)).toBe(true);
    expect(nextCaptionChoice(false, true, true)).toBe(true);
  });
});

describe("timestamped share (OPP-02)", () => {
  it("opens a few seconds before the shared moment", () => {
    expect(shareStartSeconds(20_000, 90_000)).toBe((20_000 - SHARE_PREROLL_MS) / 1_000);
    expect(shareStartSeconds(6_400, 10_000)).toBe(3);
  });

  it("opens at the start when shared early, at the very end, or without a position", () => {
    expect(shareStartSeconds(4_999, 90_000)).toBeNull();
    expect(shareStartSeconds(89_000, 90_000)).toBeNull();
    expect(shareStartSeconds(Number.NaN, 90_000)).toBeNull();
  });

  it("round-trips through the share URL", () => {
    const catalog = getLaunchFeedCatalog();
    const item = createDeterministicFeedSource(catalog).getOrderedItems()[2]!;
    const url = buildShareUrl(catalog, item, "https://flow.example", {
      shareId: "share_x",
      startSeconds: 4,
    });
    expect(url).not.toBeNull();
    const search = new URL(url!).search;
    expect(parseShareStartMs(search, 10_000)).toBe(4_000);
    const without = buildShareUrl(catalog, item, "https://flow.example", {
      startSeconds: null,
    });
    expect(new URL(without!).searchParams.has("t")).toBe(false);
  });

  it("ignores a malformed or out-of-range t", () => {
    expect(parseShareStartMs("?t=abc", 10_000)).toBeNull();
    expect(parseShareStartMs("?t=-3", 10_000)).toBeNull();
    expect(parseShareStartMs("?t=0", 10_000)).toBeNull();
    expect(parseShareStartMs("?t=9", 10_000)).toBeNull();
    expect(parseShareStartMs("?t=4.5", 10_000)).toBeNull();
    expect(parseShareStartMs("", 10_000)).toBeNull();
  });
});

describe("episode position (UX-07)", () => {
  it("reads with its total", () => {
    expect(episodePosition(3, 60)).toEqual({
      text: "Episode 3 / 60",
      label: "Episode 3 of 60",
    });
  });

  it("drops a total that is unknown or contradicts the episode", () => {
    expect(episodePosition(3, null).text).toBe("Episode 3");
    expect(episodePosition(3, 2).text).toBe("Episode 3");
    expect(episodePosition(1, 0).text).toBe("Episode 1");
  });
});

describe("the end of a series (UX-06, VIR-7)", () => {
  const catalog = withStressEpisodes(getLaunchFeedCatalog(), 180);
  const ordered = createDeterministicFeedSource(catalog).getOrderedItems();
  const byId = (id: string) => ordered.find((item) => item.id === id)!;

  it("offers another series, from its first episode, never the one that ended", () => {
    const ended = byId("item_stress_2_60");
    const items = [ended, byId("item_stress_3_14"), byId("item_stress_1_5")];
    const next = pickNextStory(items, 0, ordered);
    expect(next?.id).toBe("item_stress_3_1");
  });

  it("skips listed episodes of the same series", () => {
    const ended = byId("item_stress_2_60");
    const items = [ended, byId("item_stress_2_59"), byId("item_stress_1_5")];
    expect(pickNextStory(items, 0, ordered)?.seriesId).toBe("series_stress_1");
  });

  it("falls back to the catalog, and is null when there is no other story", () => {
    const ended = byId("item_stress_2_60");
    expect(pickNextStory([ended], 0, ordered)?.seriesId).not.toBe("series_stress_2");

    const single =
      createDeterministicFeedSource(getLaunchFeedCatalog()).getOrderedItems();
    const last = single[single.length - 1]!;
    expect(pickNextStory([last], 0, single)).toBeNull();
    expect(pickNextStory([], 0, single)).toBeNull();
  });

  it("places the story where it is listed ahead, or right after the episode on screen", () => {
    const a = byId("item_stress_2_60");
    const b = byId("item_stress_1_5");
    const story = byId("item_stress_3_1");

    const ahead = placeStory([a, b, story], 0, story);
    expect(ahead.index).toBe(2);

    const inserted = placeStory([a, b], 0, story);
    expect(inserted.items.map((item) => item.id)).toEqual([a.id, story.id, b.id]);
    expect(inserted.index).toBe(1);

    // Already passed: moved, never listed twice.
    const passed = placeStory([story, a, b], 1, story);
    expect(passed.items.map((item) => item.id)).toEqual([a.id, story.id, b.id]);
    expect(passed.index).toBe(1);
  });

  it("shares a finished story from its first episode", () => {
    expect(storyShareTarget(byId("item_stress_2_60"), ordered).id).toBe(
      "item_stress_2_1",
    );
  });
});
