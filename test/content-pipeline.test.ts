/**
 * The content pipeline's judgement, tested without ffmpeg.
 *
 * Everything the gate decides (CP-2) and everything it reads from a subtitle
 * file (CP-3) is a pure function over text, so each rule is proven here on
 * real ffmpeg output instead of being trusted because a run once looked fine.
 * The rules that matter are also proven to FAIL: a check that has never
 * failed is not a check.
 */
import { describe, expect, it } from "vitest";

import {
  QUALITY_RULES,
  checkDuplicateSource,
  checkMasterShape,
  checkPicture,
  checkPublishedLoudness,
  checkSilence,
  chooseAudioStream,
  displayDimensions,
  parseDetections,
  parseEbur128Summary,
  parseLoudnormJson,
} from "../scripts/lib/media-gate.mjs";
import {
  captionNotes,
  captionSummary,
  checkCaptionTrack,
  isLanguageTag,
  isLicensedLanguage,
  parseTimestamp,
  parseVttCues,
  srtToVtt,
} from "../scripts/lib/vtt.mjs";
import {
  checkCaptionLicence,
  checkCaptionsDeclared,
  checkEpisodeNumbers,
  checkEpisodeSlugs,
  checkRights,
  gateOptionsFor,
  isInside,
  isPackageCurrent,
  isSlug,
  packageFlags,
} from "../scripts/lib/delivery-rules.mjs";

const codes = (issues: Array<{ code: string }>) => issues.map((issue) => issue.code);

/** Real ffmpeg 8 output, copied from a run on the stand-in pack. */
const LOUDNORM_JSON = `
[Parsed_loudnorm_1 @ 0000024b10f0bec0]
{
	"input_i" : "-44.64",
	"input_tp" : "-40.15",
	"input_lra" : "0.00",
	"input_thresh" : "-54.64",
	"output_i" : "-15.96",
	"output_tp" : "-11.54",
	"output_lra" : "0.00",
	"output_thresh" : "-25.96",
	"normalization_type" : "dynamic",
	"target_offset" : "-0.04"
}
`;

const EBUR128_SUMMARY = `
[Parsed_ebur128_0 @ 000001] Summary:

  Integrated loudness:
    I:         -16.0 LUFS
    Threshold: -26.2 LUFS

  Loudness range:
    LRA:         1.2 LU
    Threshold: -36.2 LUFS

  True peak:
    Peak:       -1.5 dBFS
`;

describe("reading what ffmpeg measured", () => {
  it("reads the first-pass loudness", () => {
    expect(parseLoudnormJson(LOUDNORM_JSON)).toEqual({
      inputI: -44.64,
      inputTp: -40.15,
      inputLra: 0,
      inputThresh: -54.64,
      targetOffset: -0.04,
    });
  });

  it("returns null when there is no measurement, instead of a zero", () => {
    expect(parseLoudnormJson("ffmpeg said nothing useful")).toBeNull();
    expect(parseEbur128Summary("no summary here")).toBeNull();
  });

  it("reads the ebur128 summary of the packaged audio", () => {
    expect(parseEbur128Summary(EBUR128_SUMMARY)).toEqual({
      integratedLufs: -16,
      loudnessRangeLu: 1.2,
      truePeakDb: -1.5,
    });
  });

  it("reads black, freeze and silence ranges", () => {
    const detections = parseDetections(`
[blackdetect @ 0x1] black_start:0 black_end:6.24 black_duration:6.24
[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 2.5
[freezedetect @ 0x2] lavfi.freezedetect.freeze_duration: 3.1
[freezedetect @ 0x2] lavfi.freezedetect.freeze_end: 5.6
[silencedetect @ 0x3] silence_start: 0
[silencedetect @ 0x3] silence_end: 3.5 | silence_duration: 3.5
`);
    expect(detections.black).toEqual([{ start: 0, end: 6.24, duration: 6.24 }]);
    expect(detections.freeze).toEqual([{ start: 2.5, duration: 3.1 }]);
    expect(detections.silence).toEqual([{ start: 0, end: 3.5, duration: 3.5 }]);
  });

  it("a freeze still running at the end of the file has no duration line", () => {
    const detections = parseDetections("lavfi.freezedetect.freeze_start: 7.0");
    expect(detections.freeze).toEqual([{ start: 7, duration: null }]);
    // Measured to the end of the file: 3 s is an end card, 13 s is a frozen master.
    expect(checkPicture(detections, 10_000)).toEqual([]);
    expect(codes(checkPicture(detections, 20_000))).toEqual(["frozen_picture"]);
  });
});

describe("the shape of a delivered master", () => {
  const good = { width: 1080, height: 1920, fps: 30, durationMs: 90_000 };

  it("accepts a vertical 1080x1920 episode of normal length", () => {
    expect(checkMasterShape(good)).toEqual([]);
  });

  it("refuses a horizontal master", () => {
    expect(codes(checkMasterShape({ ...good, width: 1920, height: 1080 }))).toContain(
      "not_vertical",
    );
  });

  it("refuses a master below the curation gate unless the pack declares it", () => {
    const small = { ...good, width: 720, height: 1280 };
    expect(codes(checkMasterShape(small))).toContain("below_curation_height");
    expect(checkMasterShape(small, { allowBelow1080p: true })).toEqual([]);
  });

  it("refuses 15-second and six-minute episodes, and takes the series range", () => {
    expect(codes(checkMasterShape({ ...good, durationMs: 15_000 }))).toContain(
      "duration_out_of_range",
    );
    expect(codes(checkMasterShape({ ...good, durationMs: 360_000 }))).toContain(
      "duration_out_of_range",
    );
    expect(
      checkMasterShape(
        { ...good, durationMs: 10_000 },
        { durationMinMs: 8_000, durationMaxMs: 15_000 },
      ),
    ).toEqual([]);
  });

  it("refuses an unreadable duration instead of treating it as zero", () => {
    expect(codes(checkMasterShape({ ...good, durationMs: Number.NaN }))).toContain(
      "unreadable_duration",
    );
  });

  it("refuses a frame rate no phone shot", () => {
    expect(codes(checkMasterShape({ ...good, fps: 12 }))).toContain("unusual_fps");
  });
});

describe("the picture as the viewer sees it", () => {
  it("applies a rotation flag before the shape is judged", () => {
    // ffprobe 8 on a vertical picture stored sideways (-display_rotation -90).
    const sideways = { width: 1280, height: 720, side_data_list: [{ rotation: -90 }] };
    expect(displayDimensions(sideways)).toEqual({ width: 720, height: 1280, rotation: 270 });
    expect(
      checkMasterShape(
        { ...displayDimensions(sideways), fps: 25, durationMs: 60_000 },
        { allowBelow1080p: true },
      ),
    ).toEqual([]);
  });

  it("a landscape picture stored as vertical pixels is refused", () => {
    const flagged = { width: 720, height: 1280, side_data_list: [{ rotation: 90 }] };
    const shown = displayDimensions(flagged);
    expect(shown).toEqual({ width: 1280, height: 720, rotation: 90 });
    expect(
      codes(checkMasterShape({ ...shown, fps: 25, durationMs: 60_000 }, { allowBelow1080p: true })),
    ).toEqual(["not_vertical"]);
  });

  it("reads the old rotate tag, and leaves an unrotated or upside-down picture alone", () => {
    expect(displayDimensions({ width: 1920, height: 1080, tags: { rotate: "90" } })).toEqual({
      width: 1080,
      height: 1920,
      rotation: 90,
    });
    expect(displayDimensions({ width: 1080, height: 1920 })).toEqual({
      width: 1080,
      height: 1920,
      rotation: 0,
    });
    expect(displayDimensions({ width: 1080, height: 1920, side_data_list: [{ rotation: 180 }] })).toEqual(
      { width: 1080, height: 1920, rotation: 180 },
    );
  });
});

describe("the delivery file", () => {
  it("slugs are URL segments and folder names, nothing else", () => {
    for (const good of ["episode-1", "ep1", "the-last-call-2"]) expect(isSlug(good)).toBe(true);
    for (const bad of ["..", "../..", "a/b", "a\\b", "Episode-1", "ep--1", "-ep", "", "ep 1"]) {
      expect(isSlug(bad)).toBe(false);
    }
  });

  it("refuses an episode slug that leaves its folder, and two episodes sharing one", () => {
    expect(codes(checkEpisodeSlugs([{ episodeNumber: 1, episodeSlug: ".." }]))).toEqual([
      "bad_episode_slug",
    ]);
    expect(
      codes(
        checkEpisodeSlugs([
          { episodeNumber: 1, episodeSlug: "pilot" },
          { episodeNumber: 2, episodeSlug: "pilot" },
        ]),
      ),
    ).toEqual(["duplicate_episode_slug"]);
    expect(checkEpisodeSlugs([{ episodeNumber: 1 }, { episodeNumber: 2 }])).toEqual([]);
  });

  it("keeps a path inside its folder", () => {
    expect(isInside("/pub/series", "/pub/series/show/hls/episode-1")).toBe(true);
    expect(isInside("/pub/series/show/hls", "/pub/series/show/hls/..")).toBe(false);
    expect(isInside("/pub/series/show/hls", "/pub/series/show/hls")).toBe(false);
    expect(isInside("/pub/series", "/pub/series-other/x")).toBe(false);
  });

  it("episode numbers must run 1..N", () => {
    expect(checkEpisodeNumbers([{ episodeNumber: 1 }, { episodeNumber: 2 }])).toEqual([]);
    expect(
      codes(checkEpisodeNumbers([{ episodeNumber: 1 }, { episodeNumber: 2 }, { episodeNumber: 2 }, { episodeNumber: 4 }])),
    ).toEqual(["duplicate_episode_number", "episode_gap"]);
  });
});

describe("rights the site can honour (F8)", () => {
  const base = {
    defaultLocale: "en",
    rights: { territories: ["WORLD"], languages: ["en", "es"], windowStart: null, windowEnd: null },
  };

  it("accepts a worldwide licence in the language the episodes are spoken in", () => {
    expect(checkRights(base)).toEqual([]);
  });

  it("refuses a territory limit: the export is served everywhere", () => {
    const usOnly = { ...base, rights: { ...base.rights, territories: ["US"] } };
    expect(checkRights(usOnly)[0]).toContain("cannot restrict by country");
    const mixed = { ...base, rights: { ...base.rights, territories: ["WORLD", "US"] } };
    expect(checkRights(mixed)).toHaveLength(1);
  });

  it("refuses episodes spoken in a language the licence does not cover", () => {
    expect(checkRights({ ...base, defaultLocale: "fr" })[0]).toContain("defaultLocale");
  });

  it("refuses a caption language outside the licence; a regional tag is covered", () => {
    expect(codes(checkCaptionLicence("fr", base.rights))).toEqual(["caption_language_not_licensed"]);
    expect(checkCaptionLicence("es-419", base.rights)).toEqual([]);
    expect(isLicensedLanguage("en", ["en-US"])).toBe(false);
    expect(isLicensedLanguage("fil", ["fil"])).toBe(true);
  });
});

describe("resuming a packaged episode", () => {
  const delivery = { allowBelow1080p: true, episodeDurationMs: { min: 8000, max: 20000 } };
  const options = gateOptionsFor(delivery, { audioStream: 1 });
  const record = { sourceSha256: "abc", gateVersion: 3, gateOptions: { ...options } };
  const expected = { sourceSha256: "abc", gateVersion: 3, gateOptions: options };

  it("records the options as the flags the gate runs with", () => {
    expect(options).toEqual({
      allowBelow1080p: true,
      audioStream: 1,
      durationMinMs: 8000,
      durationMaxMs: 20000,
    });
    expect(packageFlags(options)).toEqual([
      "--allow-below-1080p",
      "--duration-min-ms",
      "8000",
      "--duration-max-ms",
      "20000",
      "--audio-stream",
      "1",
    ]);
    expect(packageFlags(gateOptionsFor({}, {}))).toEqual([]);
  });

  it("reuses only a package judged with the same master, rules and options", () => {
    expect(isPackageCurrent(record, expected)).toBe(true);
    expect(isPackageCurrent({ ...record, sourceSha256: "other" }, expected)).toBe(false);
    expect(isPackageCurrent({ ...record, gateVersion: 2 }, expected)).toBe(false);
  });

  it("a corrected audio stream, length range or resolution exception is judged again", () => {
    for (const change of [
      { audioStream: 0 },
      { durationMaxMs: 15000 },
      { durationMinMs: null },
      { allowBelow1080p: false },
    ]) {
      expect(
        isPackageCurrent(record, { ...expected, gateOptions: { ...options, ...change } }),
      ).toBe(false);
    }
  });

  it("a package recorded before options were recorded is not current", () => {
    const { gateOptions: _ignored, ...old } = record;
    expect(isPackageCurrent(old, expected)).toBe(false);
    expect(isPackageCurrent(null, expected)).toBe(false);
  });
});

describe("which audio stream carries the dialogue", () => {
  const video = { codec_type: "video", width: 1080, height: 1920 };

  it("a master with no audio would ship silent", () => {
    expect(codes(chooseAudioStream([video]).issues)).toEqual(["no_audio"]);
  });

  it("one audio stream needs no decision", () => {
    expect(chooseAudioStream([video, { codec_type: "audio", channels: 2 }])).toEqual({
      index: 0,
      issues: [],
    });
  });

  it("two streams must be chosen by the delivery, never guessed", () => {
    const streams = [
      video,
      { codec_type: "audio", channels: 2, tags: { language: "eng" } },
      { codec_type: "audio", channels: 6, tags: { language: "und" } },
    ];
    expect(codes(chooseAudioStream(streams).issues)).toEqual(["ambiguous_audio"]);
    expect(chooseAudioStream(streams, 1).index).toBe(1);
    expect(codes(chooseAudioStream(streams, 7).issues)).toEqual([
      "audio_stream_out_of_range",
    ]);
  });
});

describe("black, frozen and silent", () => {
  it("accepts an episode with nothing detected", () => {
    const nothing = { black: [], freeze: [], silence: [] };
    expect(checkPicture(nothing, 90_000)).toEqual([]);
    expect(checkSilence(nothing, 90_000)).toEqual([]);
  });

  it("refuses a black opening and allows a short black frame later", () => {
    expect(
      codes(
        checkPicture({ black: [{ start: 0, end: 2, duration: 2 }], freeze: [], silence: [] }, 90_000),
      ),
    ).toEqual(["black_opening"]);
    expect(
      checkPicture(
        { black: [{ start: 40, end: 40.4, duration: 0.4 }], freeze: [], silence: [] },
        90_000,
      ),
    ).toEqual([]);
  });

  it("refuses a still picture in the opening: the hook does not move", () => {
    const opening = { black: [], freeze: [{ start: 0.5, duration: 2 }], silence: [] };
    expect(codes(checkPicture(opening, 90_000))).toEqual(["frozen_opening"]);
    // A still that only grazes the opening is a shot that ends there.
    const grazing = { black: [], freeze: [{ start: 4, duration: 3 }], silence: [] };
    expect(checkPicture(grazing, 90_000)).toEqual([]);
  });

  it("accepts the endings short drama is made of: fade, end card, freeze-frame", () => {
    // Real freezedetect output for the proof deliveries: a 2 s still that runs
    // to the end of the file has no duration line.
    for (const tail of [
      { start: 88, duration: 2 },
      { start: 85, duration: null },
      { start: 60, duration: 6 },
    ]) {
      expect(checkPicture({ black: [], freeze: [tail], silence: [] }, 90_000)).toEqual([]);
    }
  });

  it("refuses a still longer than any shot: the master froze", () => {
    const frozen = { black: [], freeze: [{ start: 30, duration: 12 }], silence: [] };
    expect(codes(checkPicture(frozen, 90_000))).toEqual(["frozen_picture"]);
    const toTheEnd = { black: [], freeze: [{ start: 70, duration: null }], silence: [] };
    expect(codes(checkPicture(toTheEnd, 90_000))).toEqual(["frozen_picture"]);
  });

  it("refuses a silent opening and an episode that is mostly silence", () => {
    expect(
      codes(
        checkSilence(
          { black: [], freeze: [], silence: [{ start: 0, end: 4, duration: 4 }] },
          90_000,
        ),
      ),
    ).toEqual(["silent_opening"]);
    // A natural dialogue pause of 1.8s inside the first 5s (e.g. at 3.19s) is accepted
    expect(
      codes(
        checkSilence(
          { black: [], freeze: [], silence: [{ start: 3.19, end: 4.99, duration: 1.8 }] },
          90_000,
        ),
      ),
    ).toEqual([]);
    // Silence >= 2.5s in the first 5s is refused
    expect(
      codes(
        checkSilence(
          { black: [], freeze: [], silence: [{ start: 0, end: 3, duration: 3 }] },
          90_000,
        ),
      ),
    ).toEqual(["silent_opening"]);
    expect(
      codes(
        checkSilence(
          { black: [], freeze: [], silence: [{ start: 20, end: 80, duration: 60 }] },
          90_000,
        ),
      ),
    ).toEqual(["mostly_silent"]);
  });
});

describe("the loudness of what is published", () => {
  it("accepts audio on target", () => {
    expect(
      checkPublishedLoudness({ integratedLufs: -16, truePeakDb: -1.5, loudnessRangeLu: 3 }),
    ).toEqual([]);
  });

  it("refuses audio 10 LU too quiet: the viewer would reach for the volume", () => {
    expect(
      codes(
        checkPublishedLoudness({
          integratedLufs: -26,
          truePeakDb: -6,
          loudnessRangeLu: 3,
        }),
      ),
    ).toEqual(["loudness_off_target"]);
  });

  it("refuses a true peak that clips, and a missing measurement", () => {
    expect(
      codes(
        checkPublishedLoudness({ integratedLufs: -16, truePeakDb: 0.5, loudnessRangeLu: 3 }),
      ),
    ).toEqual(["true_peak_too_high"]);
    expect(codes(checkPublishedLoudness(null))).toEqual(["loudness_unmeasured"]);
  });

  it("the target is the one the standard states", () => {
    expect(QUALITY_RULES.targetLufs).toBe(-16);
  });
});

describe("the same master twice", () => {
  it("is refused with the episode that already used it", () => {
    const seen = new Map([["abc", "signal-night episode 2"]]);
    expect(checkDuplicateSource("abc", seen)[0].message).toContain("episode 2");
    expect(checkDuplicateSource("other", seen)).toEqual([]);
  });
});

describe("subtitles", () => {
  const vtt = [
    "WEBVTT",
    "",
    "00:00:00.500 --> 00:00:02.500",
    "Something is wrong with the night.",
    "",
    "00:00:03.000 --> 00:00:05.500",
    "Do not answer the signal.",
    "",
    "00:00:06.000 --> 00:00:07.800",
    "Stay quiet.",
    "",
  ].join("\n");

  it("reads timestamps in both forms, and refuses nonsense", () => {
    expect(parseTimestamp("00:00:02.500")).toBe(2_500);
    expect(parseTimestamp("01:02.250")).toBe(62_250);
    expect(parseTimestamp("00:00:02,500")).toBe(2_500);
    expect(parseTimestamp("2.5")).toBeNull();
    expect(parseTimestamp("00:99:02.500")).toBeNull();
  });

  it("parses cues, and a byte-order mark does not hide the header", () => {
    // Written as a code point on purpose: a literal BOM in the source is
    // exactly the character that makes a file look fine and behave oddly.
    const parsed = parseVttCues(`${String.fromCharCode(0xfeff)}${vtt}`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.cues).toHaveLength(3);
    expect(parsed.cues[0]).toEqual({
      startMs: 500,
      endMs: 2_500,
      text: "Something is wrong with the night.",
    });
  });

  it("accepts a file that fits its episode", () => {
    expect(checkCaptionTrack(parseVttCues(vtt), { durationMs: 10_000, language: "en" })).toEqual(
      [],
    );
    expect(captionSummary(parseVttCues(vtt), 10_000)).toEqual({
      cues: 3,
      firstCueMs: 500,
      lastCueEndMs: 7_800,
      coverage: 0.63,
    });
  });

  it("refuses a file that is not WebVTT at all", () => {
    expect(codes(checkCaptionTrack(parseVttCues("1\n00:00:01,000"), {
      durationMs: 10_000,
      language: "en",
    }))).toContain("not_webvtt");
  });

  it("refuses an empty file, and a language that is not a tag", () => {
    expect(codes(checkCaptionTrack(parseVttCues("WEBVTT\n"), {
      durationMs: 10_000,
      language: "en",
    }))).toEqual(["no_cues"]);
    expect(
      codes(checkCaptionTrack(parseVttCues(vtt), { durationMs: 10_000, language: "English" })),
    ).toEqual(["missing_language"]);
  });

  it("accepts 3-letter languages: Filipino, Cantonese, Hawaiian", () => {
    for (const tag of ["fil", "yue", "haw", "pt-BR", "zh-Hant", "es-419"]) {
      expect(isLanguageTag(tag)).toBe(true);
      expect(checkCaptionTrack(parseVttCues(vtt), { durationMs: 10_000, language: tag })).toEqual(
        [],
      );
    }
    for (const tag of ["English", "e", "engl", "EN", "en_US", ""]) expect(isLanguageTag(tag)).toBe(false);
  });

  it("refuses cues that drift past the end of the episode", () => {
    // The classic 25 → 23.976 fps conversion: everything 4% late.
    const drifted = vtt.replace("00:00:06.000 --> 00:00:07.800", "00:00:11.000 --> 00:00:13.400");
    expect(codes(checkCaptionTrack(parseVttCues(drifted), {
      durationMs: 10_000,
      language: "en",
    }))).toContain("drifts_past_the_end");
  });

  it("refuses a file that stops halfway and one that starts far too late", () => {
    const short = ["WEBVTT", "", "00:00:00.500 --> 00:00:03.500", "Only the opening.", ""].join(
      "\n",
    );
    expect(
      codes(checkCaptionTrack(parseVttCues(short), { durationMs: 90_000, language: "en" })),
    ).toEqual(expect.arrayContaining(["stops_too_early", "too_little_dialogue"]));

    const late = ["WEBVTT", "", "00:00:40.000 --> 00:01:20.000", "Late.", ""].join("\n");
    expect(
      codes(checkCaptionTrack(parseVttCues(late), { durationMs: 90_000, language: "en" })),
    ).toContain("starts_too_late");
  });

  it("converts SRT the way studios deliver it", () => {
    const srt = ["1", "00:00:00,500 --> 00:00:02,500", "Line one.", "", "2", "00:00:03,000 --> 00:00:09,000", "Line two.", ""].join(
      "\r\n",
    );
    const converted = srtToVtt(srt);
    expect(converted.startsWith("WEBVTT")).toBe(true);
    const parsed = parseVttCues(converted);
    expect(parsed.errors).toEqual([]);
    expect(parsed.cues.map((cue) => cue.text)).toEqual(["Line one.", "Line two."]);
    expect(checkCaptionTrack(parsed, { durationMs: 10_000, language: "en" })).toEqual([]);
  });

  it("keeps a line of dialogue that is only a number", () => {
    const srt = [
      "1",
      "00:00:00,500 --> 00:00:02,500",
      "How many were there?",
      "",
      "2",
      "00:00:03,000 --> 00:00:05,500",
      "47",
      "",
      "3",
      "00:00:06,000 --> 00:00:08,000",
      "Room",
      "12",
      "",
    ].join("\n");
    const parsed = parseVttCues(srtToVtt(srt));
    expect(parsed.cues.map((cue) => cue.text)).toEqual(["How many were there?", "47", "Room 12"]);
    expect(checkCaptionTrack(parsed, { durationMs: 10_000, language: "en" })).toEqual([]);
  });

  it("refuses a file cut off after half the episode", () => {
    // The review's delivery: cues stop at 5.5 s of a 10 s episode.
    const half = [
      "WEBVTT",
      "",
      "00:00:00.500 --> 00:00:02.500",
      "Something is wrong.",
      "",
      "00:00:03.000 --> 00:00:05.500",
      "Do not answer.",
      "",
    ].join("\n");
    expect(
      codes(checkCaptionTrack(parseVttCues(half), { durationMs: 10_000, language: "en" })),
    ).toContain("stops_too_early");
  });

  it("names a long quiet tail without refusing it", () => {
    // Last cue at 60 s of 90 s: passes (two thirds), but 30 s with no text is worth a look.
    const quiet = ["WEBVTT", "", "00:00:01.000 --> 00:01:00.000", "x", ""].join("\n");
    const parsed = parseVttCues(quiet);
    expect(codes(checkCaptionTrack(parsed, { durationMs: 90_000, language: "en" }))).not.toContain(
      "stops_too_early",
    );
    expect(codes(captionNotes(parsed, 90_000))).toEqual(["quiet_tail"]);
    // A two-second sting after the last line on a short episode is not worth a word.
    expect(captionNotes(parseVttCues(vtt), 10_000)).toEqual([]);
  });

  it("checks whether captions are declared or allowNoCaptions is set", () => {
    // Missing captions without allowNoCaptions fails with no_captions
    expect(codes(checkCaptionsDeclared({ episodeNumber: 1 }))).toEqual(["no_captions"]);
    expect(codes(checkCaptionsDeclared({ episodeNumber: 1, captions: [] }))).toEqual(["no_captions"]);
    expect(codes(checkCaptionsDeclared({ episodeNumber: 1 }, { allowNoCaptions: false }))).toEqual(["no_captions"]);

    // allowNoCaptions on delivery or episode passes
    expect(checkCaptionsDeclared({ episodeNumber: 1 }, { allowNoCaptions: true })).toEqual([]);
    expect(checkCaptionsDeclared({ episodeNumber: 1, allowNoCaptions: true }, {})).toEqual([]);

    // Declared captions pass
    expect(
      checkCaptionsDeclared({
        episodeNumber: 1,
        captions: [{ language: "en", file: "captions/ep1.vtt" }],
      }),
    ).toEqual([]);
  });
});
