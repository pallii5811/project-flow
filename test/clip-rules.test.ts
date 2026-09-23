/**
 * Which seconds of an episode become a social clip, and what is written under
 * it (scripts/lib/clip-rules.mjs), tested on text ffmpeg really prints and on
 * windows whose answer is known by hand.
 *
 * The whole path, on real files with known shot changes, silences and cue
 * timings, is proven by `npm run proof:clips`.
 */
import { describe, expect, it } from "vitest";

import {
  CLIP_RULES,
  CLIP_WEIGHTS,
  PLATFORMS,
  addDays,
  assColour,
  assTime,
  boundingBoxOfBright,
  buildAssScript,
  buildClipLink,
  checkClipPermission,
  checkClipWindow,
  clipCode,
  clipIdentity,
  contrastRatio,
  cueAt,
  cuesForClip,
  describeClip,
  dropOverlapping,
  endCardRegion,
  escapeAssText,
  firstLine,
  fitOnWord,
  hashtagsFor,
  hookLineFor,
  insideSafeArea,
  loudnessRangeIn,
  parseEbur128Series,
  proposeMoments,
  quietIn,
  relativeLuminance,
  safeArea,
  scheduleClips,
  scoreWindow,
  shotChangesIn,
  snapToLineEnd,
  snapToShotChange,
  speechIn,
  spreadByEpisode,
  standInLabel,
  unionBox,
  withoutProduced,
  wrapLines,
} from "../scripts/lib/clip-rules.mjs";

const cue = (startMs: number, endMs: number, text = "A line of dialogue.") => ({ startMs, endMs, text });

/** An episode with nothing wrong with it: no black, no silence, no end card. */
const CLEAN = { black: [], freeze: [], silence: [] };

describe("the right to clip", () => {
  it("refuses a series whose licence does not mention clips", () => {
    const issues = checkClipPermission({ socialClipsAllowed: false });
    expect(issues.map((issue: { code: string }) => issue.code)).toEqual(["clips_not_allowed"]);
    expect(issues[0].message).toMatch(/socialClipsAllowed/);
  });

  it("refuses a claim with no record of where the permission is", () => {
    expect(checkClipPermission({ socialClipsAllowed: true })[0].code).toBe("clip_permission_missing");
  });

  it("refuses a permission with no date and one with no source", () => {
    const noDate = checkClipPermission({
      socialClipsAllowed: true,
      socialClipsPermission: { grantedOn: "one day", source: "an email from the studio" },
    });
    expect(noDate.map((issue: { code: string }) => issue.code)).toContain("clip_permission_date");
    const noSource = checkClipPermission({
      socialClipsAllowed: true,
      socialClipsPermission: { grantedOn: "2026-09-24", source: "ok" },
    });
    expect(noSource.map((issue: { code: string }) => issue.code)).toContain("clip_permission_source");
  });

  it("accepts a permission that says when and where", () => {
    expect(
      checkClipPermission({
        socialClipsAllowed: true,
        socialClipsPermission: { grantedOn: "2026-09-24", source: "email from the studio, 24 Sep 2026" },
      }),
    ).toEqual([]);
  });

  it("labels a pack of ours so it cannot pass for a licensed title", () => {
    expect(standInLabel({ producerOfRecord: "PROJECT FLOW — cleared stand-in pack" })?.label).toMatch(
      /not a licensed drama/,
    );
    expect(standInLabel({ producerOfRecord: "Moonlight Pictures Ltd" })).toBeNull();
  });
});

describe("reading what ffmpeg measured", () => {
  it("reads the momentary loudness the metadata filter writes", () => {
    const series = parseEbur128Series(
      "frame:0    pts:0       pts_time:0\nlavfi.r128.M=-120.691\n" +
        "frame:1    pts:4800    pts_time:0.1\nlavfi.r128.M=-22.4\n" +
        "frame:2    pts:9600    pts_time:0.2\nlavfi.r128.M=-18.1\n",
    );
    expect(series).toEqual([
      { time: 0, momentary: null },
      { time: 0.1, momentary: -22.4 },
      { time: 0.2, momentary: -18.1 },
    ]);
  });

  it("keeps silence as an absence, not as a very quiet measurement", () => {
    const series = parseEbur128Series("pts_time:1\nlavfi.r128.M=-inf\npts_time:2\nlavfi.r128.M=nan\n");
    expect(series.every((sample: { momentary: number | null }) => sample.momentary === null)).toBe(true);
    // And a window of nothing but silence has no range at all.
    expect(loudnessRangeIn(series, 0, 5)).toBeNull();
  });

  it("measures the loudest second against the quietest inside a window only", () => {
    const series = [
      { time: 1, momentary: -30 },
      { time: 2, momentary: -20 },
      { time: 3, momentary: -14 },
      { time: 9, momentary: -60 },
    ];
    expect(loudnessRangeIn(series, 1, 5)).toBe(16);
  });

  it("counts a half-overlapping line as half its words", () => {
    const speech = speechIn([cue(0, 2000, "12345678")], 1000, 3000);
    expect(speech.coveredMs).toBe(1000);
    expect(speech.characters).toBe(4);
    expect(speech.density).toBe(0.5);
  });

  it("counts picture cuts inside a window, per minute", () => {
    const shots = shotChangesIn([{ time: 1, score: 20 }, { time: 5, score: 3 }, { time: 40, score: 30 }], 0, 30);
    expect(shots.count).toBe(1);
    expect(shots.perMinute).toBe(2);
  });

  it("adds up the black and the silence a window really contains", () => {
    const quiet = quietIn(
      { black: [{ start: 9.5, end: 10.5, duration: 1 }], silence: [{ start: 12, end: 16, duration: 4 }] },
      10,
      20,
      30,
    );
    expect(quiet.blackSeconds).toBe(0.5);
    expect(quiet.silenceSeconds).toBe(4);
    expect(quiet.silenceFraction).toBe(0.4);
  });
});

describe("the series' own end card", () => {
  it("finds a still tail that starts after the last line", () => {
    const card = endCardRegion(
      { ...CLEAN, freeze: [{ start: 57, duration: 3 }] },
      60_000,
      [cue(50_000, 54_500)],
    );
    expect(card).not.toBeNull();
    expect(card.startMs).toBe(57_000);
    expect(card.endMs).toBe(60_000);
  });

  it("does not call a freeze in the middle of the story an end card", () => {
    expect(
      endCardRegion({ ...CLEAN, freeze: [{ start: 57, duration: 3 }] }, 60_000, [cue(50_000, 58_000)]),
    ).toBeNull();
    expect(endCardRegion({ ...CLEAN, freeze: [{ start: 20, duration: 3 }] }, 60_000, [])).toBeNull();
  });

  it("does not call a beat of black an end card", () => {
    expect(endCardRegion({ ...CLEAN, black: [{ start: 59.6, end: 60, duration: 0.4 }] }, 60_000, [])).toBeNull();
  });
});

describe("snapping to the picture and to the words", () => {
  it("moves a start onto a picture cut within reach, and leaves it alone beyond", () => {
    const scenes = [{ time: 16, score: 20 }, { time: 40, score: 20 }];
    expect(snapToShotChange(15, scenes)).toEqual({ seconds: 16, snapped: true, distance: 1 });
    expect(snapToShotChange(30, scenes).snapped).toBe(false);
  });

  it("knows when an instant is in the middle of somebody's sentence", () => {
    const cues = [cue(1000, 3000)];
    expect(cueAt(cues, 2000)).not.toBeNull();
    expect(cueAt(cues, 1000)).toBeNull();
    expect(cueAt(cues, 3000)).toBeNull();
  });

  it("moves an end to the end of the line, or back to its start, or not at all", () => {
    expect(snapToLineEnd(2500, [cue(1000, 3000)]).ms).toBe(3000);
    expect(snapToLineEnd(1500, [cue(1000, 3000)]).ms).toBe(1000);
    // Neither end is within the snap's reach: it stays, and is refused later.
    const long = snapToLineEnd(5000, [cue(2000, 8000)]);
    expect(long.snapped).toBe(false);
    expect(long.ms).toBe(5000);
  });
});

describe("what a window is worth", () => {
  it("adds up the weights, and keeps the value each one was applied to", () => {
    const scored = scoreWindow({
      kind: "cliffhanger",
      speech: { density: 0.5, charactersPerSecond: 10 },
      loudnessRangeLu: 6,
      shots: { perMinute: 12 },
      positionInEpisode: 0.5,
    });
    const expected =
      CLIP_WEIGHTS.kind.cliffhanger +
      0.5 * CLIP_WEIGHTS.speechDensity +
      6 * CLIP_WEIGHTS.loudnessRangeLu +
      12 * CLIP_WEIGHTS.shotChangesPerMinute +
      0.5 * CLIP_WEIGHTS.positionInEpisode +
      10 * CLIP_WEIGHTS.captionCharsPerSecond;
    expect(scored.score).toBeCloseTo(expected, 2);
    expect(scored.parts.map((part: { name: string }) => part.name)).toContain("loudness range (LU)");
  });

  it("scores an unmeasured loudness as nothing, and says it was not measured", () => {
    const scored = scoreWindow({
      kind: "dialoguePeak",
      speech: { density: 0, charactersPerSecond: 0 },
      loudnessRangeLu: null,
      shots: { perMinute: 0 },
      positionInEpisode: 0,
    });
    expect(scored.score).toBe(0);
    const part = scored.parts.find((entry: { name: string }) => entry.name === "loudness range (LU)");
    expect(part.value).toBeNull();
    expect(part.points).toBe(0);
  });
});

describe("what makes a window unpostable", () => {
  const context = (over: Record<string, unknown> = {}) => ({
    detections: CLEAN,
    cues: [],
    endCard: null,
    durationMs: 90_000,
    ...over,
  });
  const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

  it("refuses a clip too short to be worth posting", () => {
    expect(codes(checkClipWindow({ startMs: 0, endMs: 5_000 }, context()))).toContain("clip_too_short");
  });

  it("counts the end card against every platform's cap", () => {
    const justUnder = (CLIP_RULES.maxSeconds - CLIP_RULES.endCardSeconds) * 1000;
    expect(codes(checkClipWindow({ startMs: 0, endMs: justUnder }, context()))).not.toContain("clip_too_long");
    expect(codes(checkClipWindow({ startMs: 0, endMs: justUnder + 100 }, context()))).toContain("clip_too_long");
  });

  it("refuses black inside the clip", () => {
    const detections = { ...CLEAN, black: [{ start: 30, end: 30.8, duration: 0.8 }] };
    expect(codes(checkClipWindow({ startMs: 20_000, endMs: 50_000 }, context({ detections })))).toContain(
      "black_in_clip",
    );
  });

  it("refuses a clip that is mostly silence", () => {
    const detections = { ...CLEAN, silence: [{ start: 25, end: 45, duration: 20 }] };
    expect(codes(checkClipWindow({ startMs: 16_000, endMs: 55_000 }, context({ detections })))).toContain(
      "silent_clip",
    );
  });

  it("refuses a clip that reaches the series' own end card", () => {
    const endCard = { startMs: 57_000, endMs: 60_000, why: "a still picture" };
    expect(codes(checkClipWindow({ startMs: 30_000, endMs: 58_000 }, context({ endCard })))).toContain(
      "covers_end_card",
    );
  });

  it("refuses a clip that starts or ends in the middle of a line", () => {
    const cues = [cue(10_000, 14_000, "Half a sentence")];
    const starts = checkClipWindow({ startMs: 12_000, endMs: 40_000 }, context({ cues }));
    expect(codes(starts)).toContain("cut_mid_line");
    expect(starts[0].message).toMatch(/mid-word/);
    expect(codes(checkClipWindow({ startMs: 0, endMs: 12_000 }, context({ cues })))).toContain("cut_mid_line");
  });
});

describe("the moments an episode gives", () => {
  /** A 60 s episode: a cut every 4 s, a line every 5 s, a still card for the last 3 s. */
  const scenes = Array.from({ length: 14 }, (_, i) => ({ time: (i + 1) * 4, score: 20 }));
  const cues = Array.from({ length: 11 }, (_, k) => cue(k * 5000 + 2000, k * 5000 + 4500));
  const detections = { ...CLEAN, freeze: [{ start: 57, duration: 3 }] };
  const loudness = Array.from({ length: 600 }, (_, i) => ({ time: i / 10, momentary: -20 + (i % 40) / 4 }));
  const context = { cues, scenes, detections, loudness };

  it("puts the cliffhanger a beat before the end card, on a picture cut", () => {
    const { accepted } = proposeMoments({ durationMs: 60_000, episodeNumber: 2 }, context);
    const cliffhanger = accepted.find((moment: { kind: string }) => moment.kind === "cliffhanger");
    // 57 s of story, held back 2 s, 40 s long, start snapped from 15 s to the cut at 16 s.
    expect(cliffhanger.endMs).toBe(55_000);
    expect(cliffhanger.startMs).toBe(16_000);
  });

  it("offers a cold open only for the first episode", () => {
    const first = proposeMoments({ durationMs: 60_000, episodeNumber: 1 }, context);
    const second = proposeMoments({ durationMs: 60_000, episodeNumber: 2 }, context);
    expect(first.accepted.some((moment: { kind: string }) => moment.kind === "coldOpen")).toBe(true);
    expect(second.accepted.some((moment: { kind: string }) => moment.kind === "coldOpen")).toBe(false);
  });

  it("keeps the moments it refused, with the reason", () => {
    const withBlack = {
      ...context,
      detections: { ...detections, black: [{ start: 30, end: 31, duration: 1 }] },
    };
    const { accepted, refused } = proposeMoments({ durationMs: 60_000, episodeNumber: 2 }, withBlack);
    expect(accepted.some((moment: { kind: string }) => moment.kind === "cliffhanger")).toBe(false);
    const cliffhanger = refused.find((moment: { kind: string }) => moment.kind === "cliffhanger");
    expect(cliffhanger.issues.map((issue: { code: string }) => issue.code)).toContain("black_in_clip");
  });

  it("ranks the moments, best first", () => {
    const { accepted } = proposeMoments({ durationMs: 60_000, episodeNumber: 1 }, context);
    for (let i = 1; i < accepted.length; i += 1) {
      expect(accepted[i - 1].score).toBeGreaterThanOrEqual(accepted[i].score);
    }
  });

  it("drops a moment that is mostly the same seconds as a better one", () => {
    const kept = dropOverlapping([
      { episodeNumber: 1, startMs: 0, endMs: 20_000, score: 10 },
      { episodeNumber: 1, startMs: 1_000, endMs: 21_000, score: 9 },
      { episodeNumber: 1, startMs: 40_000, endMs: 60_000, score: 8 },
      { episodeNumber: 2, startMs: 0, endMs: 20_000, score: 7 },
    ]);
    expect(kept).toHaveLength(3);
    expect(kept.map((moment: { startMs: number }) => moment.startMs)).toEqual([0, 40_000, 0]);
  });
});

describe("identity, rhythm and memory", () => {
  it("identifies a clip by the seconds it is, not by the bytes it became", () => {
    const one = clipIdentity({ seriesSlug: "a", episodeNumber: 1, startMs: 0, endMs: 1000 });
    const same = clipIdentity({ seriesSlug: "a", episodeNumber: 1, startMs: 0, endMs: 1000 });
    const other = clipIdentity({ seriesSlug: "a", episodeNumber: 1, startMs: 0, endMs: 1001 });
    expect(one).toBe(same);
    expect(one).not.toBe(other);
    expect(clipCode(one)).toHaveLength(8);
  });

  const repeats = (order: number[]) => order.slice(1).filter((value, index) => value === order[index]);

  it("never posts the same episode twice in a row while another has something left", () => {
    const order = spreadByEpisode([
      { episodeNumber: 1, score: 10 },
      { episodeNumber: 1, score: 9 },
      { episodeNumber: 1, score: 8 },
      { episodeNumber: 2, score: 7 },
      { episodeNumber: 3, score: 6 },
    ]).map((moment: { episodeNumber: number }) => moment.episodeNumber);
    expect(order).toHaveLength(5);
    expect(repeats(order)).toHaveLength(0);
  });

  it("repeats an episode only when it is the last one with anything left", () => {
    const order = spreadByEpisode([
      { episodeNumber: 1, score: 10 },
      { episodeNumber: 1, score: 9 },
      { episodeNumber: 1, score: 8 },
      { episodeNumber: 2, score: 7 },
    ]).map((moment: { episodeNumber: number }) => moment.episodeNumber);
    expect(order).toHaveLength(4);
    // Three from one episode and one from another cannot alternate to the end.
    expect(repeats(order)).toEqual([1]);
  });

  it("spreads a week over days, in the order it was given", () => {
    const scheduled = scheduleClips(
      Array.from({ length: 5 }, (_, i) => ({ episodeNumber: i + 1 })),
      { perDay: 2, startDate: "2026-09-24" },
    );
    expect(scheduled.map((clip: { day: number }) => clip.day)).toEqual([0, 0, 1, 1, 2]);
    expect(scheduled[2].scheduledFor).toBe("2026-09-25");
    expect(scheduled[0].positionInDay).toBe(1);
  });

  it("crosses a month boundary the way a calendar does", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("refuses a day that is not a whole number of clips", () => {
    expect(() => scheduleClips([], { perDay: 0, startDate: "2026-09-24" })).toThrow(/whole number/);
  });

  it("leaves out what a previous run already made", () => {
    const moments = [{ identity: "a" }, { identity: "b" }];
    expect(withoutProduced(moments, [{ identity: "a" }])).toEqual([{ identity: "b" }]);
    expect(withoutProduced(moments, [])).toHaveLength(2);
  });
});

describe("the words under the clip", () => {
  const link = (over: Record<string, unknown> = {}) =>
    buildClipLink({
      siteUrl: "https://cliffies.example",
      seriesSlug: "signal-night",
      episodeSlug: "episode-3",
      startMs: 16_000,
      episodeDurationMs: 90_000,
      platform: "tiktok",
      code: "abcd1234",
      ...over,
    });

  it("opens the exact moment, with the platform and the clip on it", () => {
    const url = new URL(link().url);
    expect(url.pathname).toBe("/watch/signal-night/episode-3");
    expect(url.searchParams.get("t")).toBe("16");
    expect(url.searchParams.get("utm_source")).toBe("tiktok");
    expect(url.searchParams.get("utm_medium")).toBe("clip");
    expect(url.searchParams.get("utm_campaign")).toBe("clip-abcd1234");
  });

  it("leaves out a start the app would ignore, and says why", () => {
    // The app refuses a `t` inside the last two seconds of the episode.
    const near = link({ startMs: 89_000 });
    expect(new URL(near.url).searchParams.has("t")).toBe(false);
    expect(near.openedAtSeconds).toBeNull();
    expect(near.whyNoStart).toMatch(/within 2 s of the end/);
    const opening = link({ startMs: 0 });
    expect(new URL(opening.url).searchParams.has("t")).toBe(false);
    expect(opening.whyNoStart).toMatch(/first second/);
  });

  it("refuses a platform it does not know", () => {
    expect(() => link({ platform: "myspace" })).toThrow(/unknown platform/);
  });

  it("tags with the platform's own list plus the series' genres, without repeats", () => {
    const tags = hashtagsFor("tiktok", { genres: ["thriller", "drama"], tropes: ["mystery"] });
    expect(tags).toContain("#shortdrama");
    expect(tags).toContain("#thriller");
    expect(tags).toContain("#mystery");
    expect(new Set(tags).size).toBe(tags.length);
    // An unknown genre adds nothing rather than a tag nobody searches.
    expect(hashtagsFor("tiktok", { genres: ["kitchen-sink"] })).toEqual(hashtagsFor("tiktok", {}));
  });

  const described = (over: Record<string, unknown> = {}) =>
    describeClip({
      platform: "tiktok",
      seriesTitle: "Signal Night",
      episodeNumber: 3,
      hook: "She waited three seconds too long.\nAnd then it answered.",
      link: "https://cliffies.example/watch/signal-night/episode-3?t=16",
      hashtags: ["#shortdrama"],
      ...over,
    });

  it("writes only the series' own words and the fixed fragments", () => {
    const { text } = described();
    expect(text).toContain("Signal Night — Episode 3");
    expect(text).toContain("She waited three seconds too long.");
    // The second line of the hook is not smuggled in; only the first is used.
    expect(text).not.toContain("And then it answered.");
    expect(text).toContain("Free, no coins, no unlocks.");
    expect(text).toContain("https://cliffies.example/watch/signal-night/episode-3?t=16");
  });

  it("leaves the sentence out rather than inventing one", () => {
    const { text } = described({ hook: "   " });
    expect(text).toContain("Signal Night — Episode 3");
    expect(text.split("\n")[1]).toBe("Free, no coins, no unlocks.");
  });

  it("sends the reader to the bio where the platform allows no link in the caption", () => {
    const instagram = described({ platform: "instagram-reels" });
    expect(instagram.linkPlacement).toBe("bio");
    expect(instagram.text).toContain("link in bio");
    expect(instagram.text).not.toContain("https://");
  });

  it("drops hashtags, never the link, to fit the platform's limit", () => {
    const many = Array.from({ length: 400 }, (_, i) => `#tag${i}`);
    const { text, hashtags } = described({ hashtags: many });
    expect(text.length).toBeLessThanOrEqual(PLATFORMS.tiktok.maxTextLength);
    expect(hashtags.length).toBeLessThan(many.length);
    expect(text).toContain("https://cliffies.example/watch/signal-night/episode-3?t=16");
  });

  it("gives YouTube a title that is cut on a word, never mid-word", () => {
    const { title } = described({ platform: "youtube-shorts" });
    expect(title.length).toBeLessThanOrEqual(PLATFORMS["youtube-shorts"].maxTitleLength);
    expect(fitOnWord("one two three four", 12)).toBe("one two…");
    expect(fitOnWord("short", 12)).toBe("short");
  });

  it("carries the stand-in label into the description", () => {
    const { text } = described({ standIn: { label: "Cliffies original test pack — not a licensed drama" } });
    expect(text).toContain("not a licensed drama");
  });

  it("takes the first line of a hook, and nothing from an empty one", () => {
    expect(firstLine("One.\nTwo.")).toBe("One.");
    expect(firstLine("  \n ")).toBeNull();
  });
});

describe("the text burned into the picture", () => {
  it("leaves the platforms' own interface alone", () => {
    const safe = safeArea(1080, 1920);
    expect(safe.bottom).toBe(1440);
    expect(safe.right).toBe(918);
    expect(insideSafeArea({ left: 200, top: 200, right: 800, bottom: 1400 }, safe).inside).toBe(true);
    const over = insideSafeArea({ left: 200, top: 200, right: 800, bottom: 1500 }, safe);
    expect(over.inside).toBe(false);
    expect(over.outsideBy.bottom).toBe(60);
  });

  it("finds the box holding every drawn pixel, and nothing when none is drawn", () => {
    const frame = new Uint8Array(10 * 10);
    frame[2 * 10 + 3] = 255;
    frame[5 * 10 + 7] = 200;
    expect(boundingBoxOfBright(frame, 10, 10)).toEqual({ left: 3, top: 2, right: 7, bottom: 5 });
    expect(boundingBoxOfBright(new Uint8Array(100), 10, 10)).toBeNull();
    expect(unionBox({ left: 1, top: 1, right: 2, bottom: 2 }, null)).toEqual({ left: 1, top: 1, right: 2, bottom: 2 });
  });

  it("computes WCAG contrast the way WCAG does", () => {
    const white = relativeLuminance({ r: 255, g: 255, b: 255 });
    const black = relativeLuminance({ r: 0, g: 0, b: 0 });
    expect(contrastRatio(white, black)).toBe(21);
    // The clip's own pair: near-white letters on an opaque near-black plate.
    const text = relativeLuminance({ r: 250, g: 248, b: 244 });
    const plate = relativeLuminance({ r: 8, g: 8, b: 10 });
    expect(contrastRatio(text, plate)).toBeGreaterThan(CLIP_RULES.contrastMin);
  });

  it("wraps a line over two, as evenly as the words allow", () => {
    const wrapped = wrapLines("The signal came back at midnight.", 26);
    expect(wrapped.lines).toHaveLength(2);
    expect(wrapped.lines.join(" ")).toBe("The signal came back at midnight.");
    expect(Math.abs(wrapped.lines[0].length - wrapped.lines[1].length)).toBeLessThan(8);
    expect(wrapped.overflow).toBe(false);
  });

  it("says it needed a third line but never drops the words that did not fit", () => {
    const line = "one two three four five six seven eight nine ten eleven twelve";
    const wrapped = wrapLines(line, 12);
    expect(wrapped.overflow).toBe(true);
    expect(wrapped.lines.length).toBeGreaterThan(2);
    expect(wrapped.lines.join(" ")).toBe(line);
  });

  it("fits more characters on a line as the type shrinks, which is how a third line is solved", () => {
    const long = { startSeconds: 0, endSeconds: 2, text: "A line long enough to want three of them at full size." };
    const big = buildAssScript({
      cues: [long],
      hookLine: null,
      endCard: null,
      clipSeconds: 10,
      fontName: "Segoe UI",
      maxChars: 14,
    });
    const small = buildAssScript({
      cues: [long],
      hookLine: null,
      endCard: null,
      clipSeconds: 10,
      fontName: "Segoe UI",
      maxChars: 14,
      scale: 0.5,
    });
    expect(big.overflowing).toBe(1);
    expect(small.overflowing).toBe(0);
    expect(small.charsPerLine).toBeGreaterThan(big.charsPerLine);
  });

  it("keeps markup out of a line of dialogue", () => {
    expect(escapeAssText("a {b} c\\d\ne")).toBe("a (b) c∖d e");
  });

  it("writes the only time and colour formats ASS takes", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(61.234)).toBe("0:01:01.23");
    expect(assColour("#FAF8F4")).toBe("&H00F4F8FA");
    expect(() => assColour("white")).toThrow(/not a #rrggbb colour/);
  });

  const script = (over: Record<string, unknown> = {}) =>
    buildAssScript({
      cues: [{ startSeconds: 1, endSeconds: 3, text: "A line." }],
      hookLine: "Do not answer.",
      endCard: { title: "Signal Night", promise: "Free.", address: "cliffies.example", note: null },
      clipSeconds: 10,
      fontName: "Segoe UI",
      ...over,
    });

  it("pays for the plate's padding in the margins, so the plate itself stays inside", () => {
    const { script: text } = script();
    const safe = safeArea(CLIP_RULES.width, CLIP_RULES.height);
    const hook = text.split("\n").find((line: string) => line.startsWith("Style: Hook"));
    const margins = hook.split(",").slice(-4, -1).map(Number);
    // MarginL, MarginR, MarginV — each one the safe area plus the padding.
    expect(margins[0]).toBeGreaterThan(safe.left);
    expect(margins[2]).toBeGreaterThan(safe.top);
  });

  it("never lets a long line spill sideways out of the safe area", () => {
    expect(script().script).toContain("WrapStyle: 0");
  });

  it("offers one instant per drawn event, which is the whole union and nothing more", () => {
    const built = script();
    // hook + one cue + three end-card blocks
    expect(built.events).toBe(5);
    expect(built.sampleTimes).toHaveLength(5);
    expect(Math.max(...built.sampleTimes)).toBeGreaterThan(10);
  });

  it("shrinks every size together when the caller asks it to fit", () => {
    const big = script().script;
    const small = script({ scale: 0.8 }).script;
    const sizeOf = (text: string) => Number(text.split("\n").find((line: string) => line.startsWith("Style: Caption")).split(",")[2]);
    expect(sizeOf(small)).toBeLessThan(sizeOf(big));
  });
});

describe("the clip's own copy of the episode", () => {
  it("retimes the lines to the clip and clips the ones that straddle its edges", () => {
    const cues = cuesForClip([cue(9_000, 12_000, "Straddles"), cue(15_000, 17_000, "Inside")], 10_000, 16_000);
    expect(cues[0]).toEqual({ startSeconds: 0, endSeconds: 2, text: "Straddles" });
    expect(cues[1]).toEqual({ startSeconds: 5, endSeconds: 6, text: "Inside" });
  });

  it("takes the hook from the first line spoken, then the episode, then the series", () => {
    const spoken = hookLineFor({
      cues: [cue(10_500, 12_000, "The first thing said.")],
      startMs: 10_000,
      episodeHook: "Episode hook.",
      seriesHook: "Series hook.",
    });
    expect(spoken).toEqual({ text: "The first thing said.", from: "the first line spoken in the clip" });

    // Nobody speaks for the first four seconds: the episode's own hook.
    const quiet = hookLineFor({
      cues: [cue(20_000, 22_000, "Much later.")],
      startMs: 10_000,
      episodeHook: "Episode hook.\nSecond line.",
      seriesHook: "Series hook.",
    });
    expect(quiet).toEqual({ text: "Episode hook.", from: "the episode's hook in series.json" });

    expect(hookLineFor({ cues: [], startMs: 0, episodeHook: null, seriesHook: "Series hook." })?.from).toMatch(
      /series/,
    );
    expect(hookLineFor({ cues: [], startMs: 0, episodeHook: null, seriesHook: null })).toBeNull();
  });
});
