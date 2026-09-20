/**
 * Where a compilation breaks into episodes (scripts/lib/split-rules.mjs),
 * tested on text ffmpeg really prints. The whole path, on a real file with
 * known boundaries, is proven by `npm run proof:split`.
 */
import { describe, expect, it } from "vitest";

import { sourceIdentity } from "../scripts/lib/delivery-rules.mjs";
import {
  buildCandidates,
  buildCutsFile,
  checkCutsFile,
  checkSplitPermission,
  chooseCuts,
  fadedInto,
  parseCropDetect,
  parseFrameRate,
  parseLumaSeries,
  parseSceneChanges,
  parseTimecode,
  pillarboxVerdict,
  splitIdentity,
  timecode,
} from "../scripts/lib/split-rules.mjs";

const FPS = 25;

describe("reading ffmpeg", () => {
  it("scdet lines", () => {
    const text =
      "[scdet @ 000002dcc7a28e00] lavfi.scd.score: 14.045, lavfi.scd.time: 10\n" +
      "[scdet @ 000002dcc7a28e00] lavfi.scd.score: 29.527, lavfi.scd.time: 19.2\n";
    expect(parseSceneChanges(text)).toEqual([
      { score: 14.045, time: 10 },
      { score: 29.527, time: 19.2 },
    ]);
  });

  it("the brightness file of metadata=print", () => {
    const text = "frame:0    pts:0       pts_time:0\nlavfi.signalstats.YAVG=88.3045\nframe:1    pts:40000   pts_time:0.04\nlavfi.signalstats.YAVG=88.0708\n";
    expect(parseLumaSeries(text)).toEqual([
      { time: 0, yavg: 88.3045 },
      { time: 0.04, yavg: 88.0708 },
    ]);
  });

  it("cropdetect: the crop it settled on most, and how settled", () => {
    const line = (crop: string) => `[Parsed_cropdetect_4 @ 0] x1:656 x2:1263 y1:0 y2:1079 w:608 h:1080 x:656 y:0 pts:1 t:1 limit:24 crop=${crop}\n`;
    const text = line("1920:1080:0:0") + line("608:1080:656:0").repeat(9);
    expect(parseCropDetect(text)).toEqual({ w: 608, h: 1080, x: 656, y: 0, share: 0.9, samples: 10 });
    expect(parseCropDetect("nothing")).toBeNull();
  });

  it("frame rates and timecodes", () => {
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFrameRate("25/1")).toBe(25);
    expect(parseFrameRate("0/0")).toBeNull();
    expect(timecode(3723.04)).toBe("01:02:03.040");
    expect(parseTimecode("01:02:03.040")).toBeCloseTo(3723.04, 6);
    expect(parseTimecode("02:03.5")).toBeCloseTo(123.5, 6);
    expect(parseTimecode("nope")).toBeNull();
  });
});

describe("pillarbox", () => {
  it("a vertical picture inside a 16:9 file is reported, with the crop", () => {
    const verdict = pillarboxVerdict({ w: 608, h: 1080, x: 656, y: 0, share: 0.95 }, 1920, 1080);
    expect(verdict.pillarboxed).toBe(true);
    expect(verdict.message).toContain("Ask the studio for the vertical master");
  });

  it("a real landscape picture, a vertical file, a crop that wandered: not pillarboxed", () => {
    expect(pillarboxVerdict({ w: 1920, h: 1080, x: 0, y: 0, share: 1 }, 1920, 1080).pillarboxed).toBe(false);
    expect(pillarboxVerdict({ w: 1080, h: 1920, x: 0, y: 0, share: 1 }, 1080, 1920).pillarboxed).toBe(false);
    expect(pillarboxVerdict({ w: 608, h: 1080, x: 656, y: 0, share: 0.3 }, 1920, 1080).pillarboxed).toBe(false);
    expect(pillarboxVerdict(null, 1920, 1080).pillarboxed).toBe(false);
  });
});

describe("candidates", () => {
  it("a fade into black is told from a cut to black", () => {
    const fade = Array.from({ length: 15 }, (_, i) => ({ time: 9.4 + i * 0.04, yavg: 120 - i * 8 }));
    expect(fadedInto(fade, 10)).toBe(true);
    const cut = Array.from({ length: 15 }, (_, i) => ({ time: 9.4 + i * 0.04, yavg: 120 }));
    expect(fadedInto(cut, 10)).toBe(false);
  });

  it("black, the picture cut at its end and the silence around it are one candidate, on the first frame after the black", () => {
    const candidates = buildCandidates({
      fps: FPS,
      durationSeconds: 40,
      black: [{ start: 19.8, end: 20, duration: 0.2 }],
      silence: [{ start: 19.7, end: 20.3, duration: 0.6 }],
      scenes: [
        { time: 20, score: 30 },
        { time: 5, score: 20 },
      ],
      luma: [],
    });
    const atTwenty = candidates.find((candidate) => candidate.frame === 500);
    expect(atTwenty?.evidence.map((entry: { kind: string }) => entry.kind).sort()).toEqual(["black", "scene", "silence"]);
    expect(atTwenty?.score).toBeGreaterThanOrEqual(7);
    expect(candidates.find((candidate) => candidate.frame === 125)?.score).toBe(1);
  });

  it("a pause with no picture cut inside it is a guess, and weak", () => {
    const [only] = buildCandidates({
      fps: FPS,
      durationSeconds: 40,
      black: [],
      silence: [{ start: 19, end: 20, duration: 1 }],
      scenes: [],
    });
    expect(only?.frame).toBe(500);
    expect(only?.score).toBe(1);
  });
});

describe("choosing the cuts", () => {
  /** Four 10 s episodes; a shot change 4 s into each one, as strong as a cut. */
  const decoys = [4, 14, 24, 34].map((time) => ({ time, score: 30 }));

  it("with the episode count known, the lengths tell a boundary from a shot change", () => {
    const candidates = buildCandidates({
      fps: FPS,
      durationSeconds: 40,
      black: [{ start: 19.8, end: 20, duration: 0.2 }],
      silence: [{ start: 29.5, end: 30.2, duration: 0.7 }],
      scenes: [...decoys, { time: 10, score: 30 }, { time: 30, score: 25 }],
    });
    const result = chooseCuts({ fps: FPS, durationSeconds: 40, candidates, episodes: 4, minSeconds: 8, maxSeconds: 15 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cuts.map((cut: { frame: number }) => cut.frame)).toEqual([250, 500, 750]);
    expect(result.cuts.map((cut: { confidence: string }) => cut.confidence)).toEqual(["low", "high", "high"]);
    // The hard cut names the shot change that looked the same.
    expect(result.cuts[0].rivals.map((rival: { at: string }) => rival.at)).toContain("00:00:14.000");
  });

  it("where nothing is visible, the cut is placed by the lengths and marked none", () => {
    const candidates = buildCandidates({ fps: FPS, durationSeconds: 40, black: [], silence: [], scenes: [] });
    const result = chooseCuts({ fps: FPS, durationSeconds: 40, candidates, episodes: 2, minSeconds: 8, maxSeconds: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0].confidence).toBe("none");
    expect(result.cuts[0].frame).toBe(500);
  });

  it("an impossible count is said, not forced", () => {
    const candidates = buildCandidates({ fps: FPS, durationSeconds: 40, black: [], silence: [], scenes: [] });
    const tooMany = chooseCuts({ fps: FPS, durationSeconds: 40, candidates, episodes: 6, minSeconds: 8, maxSeconds: 15 });
    expect(tooMany).toMatchObject({ ok: false });
    const tooFew = chooseCuts({ fps: FPS, durationSeconds: 40, candidates, episodes: 2, minSeconds: 8, maxSeconds: 15 });
    expect(tooFew).toMatchObject({ ok: false });
  });

  it("without a count, only cuts that earn their place are proposed", () => {
    const candidates = buildCandidates({
      fps: FPS,
      durationSeconds: 40,
      black: [{ start: 19.8, end: 20, duration: 0.2 }],
      silence: [],
      scenes: decoys,
    });
    const result = chooseCuts({ fps: FPS, durationSeconds: 40, candidates, episodes: null, minSeconds: 8, maxSeconds: 25 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cuts.map((cut: { frame: number }) => cut.frame)).toEqual([500]);
  });
});

describe("the cuts file a person confirms", () => {
  const source = {
    file: "all.mp4",
    sha256: "a".repeat(64),
    bytes: 1,
    durationMs: 40_000,
    frames: 1000,
    frameRate: "25/1",
    width: 720,
    height: 1280,
  };
  const proposal = () =>
    buildCutsFile({
      slug: "demo",
      source,
      episodes: 4,
      cuts: [250, 500, 750].map((frame) => ({ frame, confidence: "high", why: "black", rivals: [] })),
    });
  const options = { episodes: 4, minMs: 8000, maxMs: 15_000, sourceSha256: "a".repeat(64) };

  it("is written unconfirmed, and refused until a person confirms it", () => {
    const file = proposal();
    expect(file.confirmed).toBe(false);
    expect(checkCutsFile(file, options).issues.map((entry: { code: string }) => entry.code)).toEqual(["cuts_not_confirmed"]);
    const confirmed = checkCutsFile({ ...file, confirmed: true }, options);
    expect(confirmed.issues).toEqual([]);
    expect(confirmed.episodes).toEqual([
      { episodeNumber: 1, startFrame: 0, endFrame: 250 },
      { episodeNumber: 2, startFrame: 250, endFrame: 500 },
      { episodeNumber: 3, startFrame: 500, endFrame: 750 },
      { episodeNumber: 4, startFrame: 750, endFrame: 1000 },
    ]);
  });

  it("refuses another file, a wrong count, an order that goes back, a length out of range, a half edit", () => {
    const base = { ...proposal(), confirmed: true };
    const codes = (file: object, extra: object = {}) =>
      checkCutsFile(file, { ...options, ...extra }).issues.map((entry: { code: string }) => entry.code);
    expect(codes(base, { sourceSha256: "b".repeat(64) })).toContain("cuts_other_file");
    expect(codes(base, { episodes: 5 })).toContain("cuts_count");
    const swapped = { ...base, cuts: [base.cuts[1], base.cuts[0], base.cuts[2]] };
    expect(codes(swapped)).toContain("cuts_order");
    const short = { ...base, cuts: [{ ...base.cuts[0], frame: 100, at: timecode(4) }, base.cuts[1], base.cuts[2]] };
    expect(codes(short)).toContain("cuts_length");
    const halfEdited = { ...base, cuts: [{ ...base.cuts[0], frame: 260 }, base.cuts[1], base.cuts[2]] };
    expect(codes(halfEdited)).toContain("cuts_label");
    expect(codes({ ...base, endFrame: 1001 })).toContain("cuts_bounds");
    expect(codes({ ...base, crop: { w: 608, h: 1080, x: 656, y: 0 } })).toContain("cuts_crop");
  });
});

describe("the right to split", () => {
  it("needs splitAllowed and the written OK: when and where", () => {
    expect(checkSplitPermission({}).map((entry: { code: string }) => entry.code)).toEqual(["split_not_allowed"]);
    expect(checkSplitPermission({ splitAllowed: "yes" })[0]?.code).toBe("split_not_allowed");
    expect(checkSplitPermission({ splitAllowed: true })[0]?.code).toBe("split_permission_missing");
    expect(
      checkSplitPermission({ splitAllowed: true, splitPermission: { grantedOn: "soon", source: "x" } }).map(
        (entry: { code: string }) => entry.code,
      ),
    ).toEqual(["split_permission_date", "split_permission_source"]);
    expect(
      checkSplitPermission({
        splitAllowed: true,
        splitPermission: { grantedOn: "2026-09-19", source: "email from the studio, 19 Sep 2026" },
      }),
    ).toEqual([]);
  });
});

describe("who a split episode is", () => {
  const range = { sourceSha256: "a".repeat(64), startFrame: 250, endFrame: 500, frameRate: "25/1", crop: null };

  it("the same frames of the same file are the same episode; anything else is another", () => {
    expect(splitIdentity(range)).toBe(splitIdentity({ ...range }));
    expect(splitIdentity(range)).not.toBe(splitIdentity({ ...range, endFrame: 501 }));
    expect(splitIdentity(range)).not.toBe(splitIdentity({ ...range, sourceSha256: "b".repeat(64) }));
    expect(splitIdentity(range)).not.toBe(
      splitIdentity({ ...range, crop: { w: 608, h: 1080, x: 656, y: 0, apply: true } }),
    );
    expect(splitIdentity(range)).toBe(splitIdentity({ ...range, crop: { w: 608, h: 1080, x: 656, y: 0, apply: false } }));
  });

  it("ingest reads it from the provenance file, and checks the master is the one that was written", () => {
    const identity = "c".repeat(64);
    const provenance = { identity, masterSha256: "d".repeat(64), startFrame: 250, endFrame: 500 };
    expect(sourceIdentity({ provenance, masterSha256: "d".repeat(64), masterLabel: "m.mp4" })).toEqual({
      identity,
      masterPresent: true,
      issues: [],
    });
    // The master was deleted after upload: the identity is still known.
    expect(sourceIdentity({ provenance, masterSha256: null, masterLabel: "m.mp4" }).identity).toBe(identity);
    // The master was replaced by hand: refused.
    expect(sourceIdentity({ provenance, masterSha256: "e".repeat(64), masterLabel: "m.mp4" }).issues[0]?.code).toBe(
      "master_provenance_mismatch",
    );
    expect(sourceIdentity({ provenance: { identity: "x" }, masterSha256: null, masterLabel: "m.mp4" }).issues[0]?.code).toBe(
      "bad_provenance",
    );
    expect(sourceIdentity({ provenance: null, masterSha256: "f".repeat(64), masterLabel: "m.mp4" }).identity).toBe("f".repeat(64));
    expect(sourceIdentity({ provenance: null, masterSha256: null, masterLabel: "m.mp4" }).issues[0]?.code).toBe("missing_master");
  });
});
