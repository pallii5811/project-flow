/**
 * Which seconds of an episode become a social clip, and what is written under
 * it — as pure functions (CL-1).
 *
 * The owner has no advertising budget. The only channel that grew every
 * competitor is a handful of clips posted every day on TikTok, YouTube Shorts,
 * Instagram and Facebook, each pointing at a free episode. So the machine has
 * to answer one question well, many times a day: WHICH twenty seconds.
 *
 * Nothing here is chosen at random and nothing is written by a model. Every
 * candidate is scored from things ffmpeg measured on the episode and things
 * the subtitle file says, with weights written down below so a bad clip can be
 * argued with instead of re-rolled:
 *
 *   - the CLIFFHANGER: the last seconds of an episode, cut a beat BEFORE the
 *     resolution. For this format it is the strongest unit there is — the
 *     whole point of the episode is that you must open the next one;
 *   - the COLD OPEN: the first seconds of episode 1, which carry the premise
 *     and are the only moment that explains the series to a stranger;
 *   - a DIALOGUE PEAK: a window inside an episode where people talk, the
 *     sound moves, and the picture cuts often.
 *
 * Two rules the scoring cannot bend:
 *
 *   1. a clip may only exist for a series whose licence says so in writing
 *      (`socialClipsAllowed` plus `socialClipsPermission`), the same shape the
 *      splitter demands before it cuts a file;
 *   2. a clip never starts or ends in the middle of a spoken line, never
 *      carries black or a silent stretch, and never shows the series' own end
 *      card — a posted clip is the product, seen by people who have never
 *      heard of it.
 *
 * Everything measured about the rendered file — where the text landed, its
 * contrast, its loudness — is checked by the caller against these numbers and
 * proven on real renders by `npm run proof:clips`.
 *
 * Unit-tested in test/clip-rules.test.ts.
 */
import { createHash } from "node:crypto";

/** Bumped when the way a moment is chosen changes: a clip gets a new identity. */
export const CLIP_RULES_VERSION = 1;

export const CLIP_RULES = {
  /* ---- how long a moment is ---- */
  /** The cliffhanger: the last seconds before the resolution. */
  cliffhangerMinSeconds: 20,
  cliffhangerMaxSeconds: 40,
  /** The cold open: the premise, from the very first frame. */
  coldOpenMinSeconds: 15,
  coldOpenMaxSeconds: 25,
  /** A dialogue peak inside an episode. */
  peakMinSeconds: 20,
  peakMaxSeconds: 45,
  /** Under this nothing is worth posting; over it no platform accepts it. */
  minSeconds: 8,
  maxSeconds: 60,
  /**
   * The beat held back at the end of a cliffhanger. The clip must stop BEFORE
   * the episode resolves, or there is no reason to open the episode.
   */
  holdBackSeconds: 2,
  /** How far a peak window slides between two tries. */
  peakStepSeconds: 2,

  /* ---- what disqualifies a window ---- */
  /** Black inside a clip: the viewer's thumb is already moving. */
  blackMaxSeconds: 0.4,
  /** Silence over this share of the window: it reads as a broken upload. */
  silenceMaxFraction: 0.35,
  /** A start may move this far to land on a picture cut. */
  shotSnapSeconds: 1.5,
  /** An end may move this far to land on the end of a spoken line. */
  cueSnapSeconds: 1.2,
  /** A still or black stretch at least this long at the end is the end card. */
  endCardMinSeconds: 1,
  /** The end card is looked for inside this share of the episode's tail. */
  endCardSearchFraction: 0.25,

  /* ---- the rendered file ---- */
  width: 1080,
  height: 1920,
  /** Social video is normalised louder than the app's -16: -14 is the platform norm. */
  targetLufs: -14,
  lufsToleranceLu: 1,
  truePeakDbMax: -1,
  /** The card at the end: title, the promise, the address. */
  endCardSeconds: 1.5,
  /** The hook line is on screen from the first frame, for this long. */
  hookSeconds: 1.8,

  /*
   * The platform's own interface, as a share of the frame. TikTok, Reels and
   * Shorts all stack a caption, a handle and a button row along the bottom and
   * a column of icons down the right. These are the areas nothing we burn in
   * may touch — not a guess about the design, a margin wide enough that the
   * three of them fit inside it.
   */
  uiBottomFraction: 0.25,
  uiRightFraction: 0.15,
  uiTopFraction: 0.08,
  /** Kept clear on the left too, so a centred line does not look pushed. */
  uiLeftFraction: 0.06,

  /* ---- the burned-in captions ---- */
  captionMaxLines: 2,
  /**
   * Where the bottom of the caption block sits, as a share of the frame height.
   * Just above the platform's own interface, the way a viewer expects it —
   * higher than that leaves a band of dead picture and reads as a mistake.
   */
  captionBaselineFraction: 0.73,
  /** WCAG AA for body text. Large text needs 3:1; the clips aim at the stricter one. */
  contrastMin: 4.5,
  /** Font sizes are shrunk by this much per attempt until the text fits. */
  fitShrink: 0.92,
  fitAttempts: 6,
};

/**
 * What each piece of evidence is worth, in score points. Inspectable on
 * purpose: every clip carries these numbers and the values they were applied
 * to, so "why this moment" is a table, not an opinion.
 */
export const CLIP_WEIGHTS = {
  /** Share of the window covered by subtitle cues: is anyone talking? */
  speechDensity: 40,
  /** Loudest second minus quietest second, in LU: a flat window is a flat scene. */
  loudnessRangeLu: 1.1,
  /** Picture cuts per minute: pace. */
  shotChangesPerMinute: 0.5,
  /** How far into the episode the window sits, 0 at the first frame, 1 at the last. */
  positionInEpisode: 12,
  /** Characters of dialogue per second: a dense scene beats a sparse one. */
  captionCharsPerSecond: 0.7,
  /** What the kind of moment is worth before any measurement. */
  kind: {
    cliffhanger: 25,
    coldOpen: 15,
    dialoguePeak: 0,
  },
};

/** The kinds of moment, in the order a tie is broken. */
export const CLIP_KINDS = ["cliffhanger", "coldOpen", "dialoguePeak"];

/**
 * The four places a clip is posted. Their specifications coincide today —
 * 1080x1920, H.264 and AAC, at most 60 s — so ONE rendered file serves all
 * four and only the words under it change. The cap is kept per platform
 * anyway: when one of them moves, a clip is dropped from that platform by
 * name instead of being posted and rejected.
 */
export const PLATFORMS = {
  tiktok: {
    label: "TikTok",
    maxSeconds: 60,
    utmSource: "tiktok",
    maxTextLength: 2200,
    /** Where the owner puts the link when the platform does not allow one in the text. */
    linkPlacement: "caption",
    hashtags: ["shortdrama", "verticaldrama", "freeseries", "watchfree"],
  },
  "instagram-reels": {
    label: "Instagram Reels",
    maxSeconds: 60,
    utmSource: "instagram",
    maxTextLength: 2200,
    linkPlacement: "bio",
    hashtags: ["shortdrama", "reels", "verticaldrama", "freetowatch"],
  },
  "facebook-reels": {
    label: "Facebook Reels",
    maxSeconds: 60,
    utmSource: "facebook",
    maxTextLength: 2200,
    linkPlacement: "caption",
    hashtags: ["shortdrama", "reels", "freeseries"],
  },
  "youtube-shorts": {
    label: "YouTube Shorts",
    maxSeconds: 60,
    utmSource: "youtube",
    maxTextLength: 4800,
    maxTitleLength: 100,
    linkPlacement: "description",
    hashtags: ["Shorts", "shortdrama", "freeseries"],
  },
};

/**
 * Genres and tropes as the deliveries write them, to the tag people search.
 * A maintained list on purpose: an unknown genre adds no tag rather than a
 * tag nobody uses.
 */
export const GENRE_HASHTAGS = {
  thriller: ["thriller", "suspense"],
  drama: ["drama"],
  romance: ["romance", "lovestory"],
  revenge: ["revenge"],
  mystery: ["mystery"],
  comedy: ["comedy"],
  fantasy: ["fantasy"],
  werewolf: ["werewolf"],
  billionaire: ["billionaire"],
  historical: ["historical"],
};

export const TROPE_HASHTAGS = {
  mystery: ["mystery"],
  night: [],
  secretidentity: ["secretidentity"],
  secondchance: ["secondchance"],
  enemiestolovers: ["enemiestolovers"],
  fakemarriage: ["fakemarriage"],
};

/**
 * The only sentences the machine may write. Everything else in a description
 * comes from the series' own metadata. No audience number, no superlative, no
 * claim about anyone else: a clip is seen by strangers, and one invented line
 * under it is a lie told at scale.
 */
export const COPY = {
  freePromise: "Free, no coins, no unlocks.",
  watchPrefix: "Watch the full episode free:",
  linkInBio: "Full episode free — link in bio.",
  episodeLabel: (number) => `Episode ${number}`,
};

function issue(code, message) {
  return { code, message };
}

/* -------------------------------------------------------------------------- */
/* Rights                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Clipping a work is publishing a piece of it under our name on someone
 * else's platform, so the licence has to say it may be done — the same shape
 * `checkSplitPermission` demands before a file is cut.
 *
 * `manifest` is the series manifest ingest wrote, never the delivery: what a
 * clip may be made from is what was published.
 */
export function checkClipPermission(manifest) {
  if (manifest?.socialClipsAllowed !== true) {
    return [
      issue(
        "clips_not_allowed",
        'the licence does not say clips may be posted: set "socialClipsAllowed": true in series.json only with the studio\'s written OK, record it in "socialClipsPermission", and run ingest again',
      ),
    ];
  }
  const permission = manifest?.socialClipsPermission;
  if (typeof permission !== "object" || permission === null) {
    return [
      issue(
        "clip_permission_missing",
        'socialClipsAllowed needs "socialClipsPermission": { "grantedOn", "source" }',
      ),
    ];
  }
  const problems = [];
  if (typeof permission.grantedOn !== "string" || !Number.isFinite(Date.parse(permission.grantedOn))) {
    problems.push(
      issue(
        "clip_permission_date",
        `socialClipsPermission.grantedOn "${String(permission.grantedOn)}" is not a date`,
      ),
    );
  }
  if (typeof permission.source !== "string" || permission.source.trim().length < 8) {
    problems.push(
      issue(
        "clip_permission_source",
        "socialClipsPermission.source must say where the written OK is (the email, the contract clause)",
      ),
    );
  }
  return problems;
}

/**
 * A series we made ourselves is still clipped under a label, so nobody can
 * mistake a stand-in pack for a licensed title — on the clip and in every
 * description. The producer of record is what says whose it is.
 */
export function standInLabel(manifest) {
  const record = String(manifest?.producerOfRecord ?? "");
  const own = /stand-in|standin|PROJECT FLOW|Cliffies/i.test(record);
  if (!own) return null;
  return {
    label: "Cliffies original test pack — not a licensed drama",
    why: `producerOfRecord is "${record}"`,
  };
}

/* -------------------------------------------------------------------------- */
/* Reading what ffmpeg measured                                                */
/* -------------------------------------------------------------------------- */

/**
 * The file written by `ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.M`:
 * `frame:N pts:… pts_time:T` then `lavfi.r128.M=V`, ten times a second. It is
 * read from a file rather than from the log because ffmpeg 8 no longer prints
 * the per-frame line at info level, and a measurement that depends on a log
 * level is a measurement that disappears.
 *
 * Momentary loudness under -70 LUFS is silence — an absence of sound, not a
 * measurement of it — and is kept as null, so a window made of silence has no
 * range instead of a enormous one.
 */
export function parseEbur128Series(text) {
  const out = [];
  let time = null;
  for (const line of String(text).split(/\r?\n/)) {
    const frame = /pts_time:\s*(-?[\d.]+)/.exec(line);
    if (frame) {
      time = Number(frame[1]);
      continue;
    }
    const value = /lavfi\.r128\.M=(-?[\d.]+|-inf|nan)/.exec(line);
    if (!value || time === null) continue;
    const raw = value[1];
    const momentary = raw === "-inf" || raw === "nan" ? null : Number(raw);
    out.push({
      time,
      momentary: momentary !== null && Number.isFinite(momentary) && momentary > -70 ? momentary : null,
    });
    time = null;
  }
  return out;
}

/** The loudest second minus the quietest, inside a window. null when nothing was heard. */
export function loudnessRangeIn(series, startSeconds, endSeconds) {
  const inside = series.filter(
    (sample) => sample.time >= startSeconds && sample.time < endSeconds && sample.momentary !== null,
  );
  if (inside.length < 2) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const sample of inside) {
    if (sample.momentary < low) low = sample.momentary;
    if (sample.momentary > high) high = sample.momentary;
  }
  return Number((high - low).toFixed(2));
}

/** Seconds of a window covered by subtitle cues, and the characters spoken in it. */
export function speechIn(cues, startMs, endMs) {
  let coveredMs = 0;
  let characters = 0;
  let lines = 0;
  for (const cue of cues) {
    const overlap = Math.min(cue.endMs, endMs) - Math.max(cue.startMs, startMs);
    if (overlap <= 0) continue;
    coveredMs += overlap;
    lines += 1;
    const span = cue.endMs - cue.startMs;
    // A cue half inside the window contributes half its words.
    characters += span > 0 ? Math.round((cue.text.length * overlap) / span) : 0;
  }
  const windowMs = endMs - startMs;
  return {
    coveredMs,
    characters,
    lines,
    density: windowMs > 0 ? Number((coveredMs / windowMs).toFixed(3)) : 0,
    charactersPerSecond: windowMs > 0 ? Number(((characters * 1000) / windowMs).toFixed(2)) : 0,
  };
}

/** Picture cuts inside a window, per minute of it. */
export function shotChangesIn(scenes, startSeconds, endSeconds, threshold = 8) {
  const inside = scenes.filter(
    (scene) => scene.time >= startSeconds && scene.time < endSeconds && scene.score >= threshold,
  );
  const minutes = (endSeconds - startSeconds) / 60;
  return {
    count: inside.length,
    perMinute: minutes > 0 ? Number((inside.length / minutes).toFixed(2)) : 0,
    times: inside.map((scene) => Number(scene.time.toFixed(3))),
  };
}

/** Seconds of black and of silence inside a window. */
export function quietIn(detections, startSeconds, endSeconds, durationSeconds) {
  const overlapOf = (ranges, fallbackEnd) => {
    let total = 0;
    for (const range of ranges) {
      const end = range.end ?? fallbackEnd;
      const overlap = Math.min(end, endSeconds) - Math.max(range.start, startSeconds);
      if (overlap > 0) total += overlap;
    }
    return Number(total.toFixed(3));
  };
  const windowSeconds = endSeconds - startSeconds;
  const silence = overlapOf(detections.silence ?? [], durationSeconds);
  return {
    blackSeconds: overlapOf(detections.black ?? [], durationSeconds),
    silenceSeconds: silence,
    silenceFraction: windowSeconds > 0 ? Number((silence / windowSeconds).toFixed(3)) : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* The series' own end card                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where the episode stops being story: a still or black stretch at the very
 * end, after the last spoken line. A clip that runs into it posts our own
 * logo instead of the moment, which is the one frame nobody swipes for.
 *
 * Returns { startMs, endMs, why } or null when the episode ends on the story.
 */
export function endCardRegion(detections, durationMs, cues, rules = CLIP_RULES) {
  const durationSeconds = durationMs / 1000;
  const searchFrom = durationSeconds * (1 - rules.endCardSearchFraction);
  const lastCueEndSeconds =
    cues.length > 0 ? Math.max(...cues.map((cue) => cue.endMs)) / 1000 : 0;
  const stretches = [];
  for (const range of detections.freeze ?? []) {
    const duration = range.duration ?? Math.max(0, durationSeconds - range.start);
    stretches.push({ start: range.start, end: range.start + duration, kind: "a still picture" });
  }
  for (const range of detections.black ?? []) {
    const end = range.end ?? durationSeconds;
    stretches.push({ start: range.start, end, kind: "black" });
  }
  let found = null;
  for (const stretch of stretches) {
    const length = stretch.end - stretch.start;
    if (length < rules.endCardMinSeconds) continue;
    if (stretch.start < searchFrom) continue;
    // It has to run to the end of the episode, and start after the talking.
    if (stretch.end < durationSeconds - 0.5) continue;
    if (stretch.start < lastCueEndSeconds) continue;
    if (found === null || stretch.start < found.start) found = stretch;
  }
  if (found === null) return null;
  return {
    startMs: Math.round(found.start * 1000),
    endMs: durationMs,
    why: `${found.kind} for the last ${(durationSeconds - found.start).toFixed(1)} s, after the last line`,
  };
}

/* -------------------------------------------------------------------------- */
/* Snapping to the picture and to the words                                    */
/* -------------------------------------------------------------------------- */

/**
 * A clip that starts on a picture cut looks like it was made that way. One
 * that starts two frames after it looks broken. Moves the start at most
 * `shotSnapSeconds`, and only backwards or forwards onto a real cut.
 */
export function snapToShotChange(seconds, scenes, rules = CLIP_RULES, threshold = 8) {
  let best = null;
  for (const scene of scenes) {
    if (scene.score < threshold) continue;
    const distance = Math.abs(scene.time - seconds);
    if (distance > rules.shotSnapSeconds) continue;
    if (best === null || distance < Math.abs(best.time - seconds)) best = scene;
  }
  if (best === null) return { seconds, snapped: false, distance: null };
  return {
    seconds: Number(best.time.toFixed(3)),
    snapped: true,
    distance: Number((best.time - seconds).toFixed(3)),
  };
}

/**
 * Is this instant in the middle of somebody's sentence? Strictly inside a cue
 * means the clip would begin or end mid-word.
 */
export function cueAt(cues, ms) {
  return cues.find((cue) => ms > cue.startMs && ms < cue.endMs) ?? null;
}

/**
 * Moves an end onto the end of the line being spoken, when one is running and
 * it finishes within reach. Returns the instant and why it moved.
 */
export function snapToLineEnd(ms, cues, rules = CLIP_RULES) {
  const cue = cueAt(cues, ms);
  if (cue === null) return { ms, snapped: false, distance: null };
  const forward = cue.endMs - ms;
  const backward = ms - cue.startMs;
  const reachMs = rules.cueSnapSeconds * 1000;
  if (forward <= reachMs) return { ms: cue.endMs, snapped: true, distance: forward };
  if (backward <= reachMs) return { ms: cue.startMs, snapped: true, distance: -backward };
  return { ms, snapped: false, distance: null };
}

/* -------------------------------------------------------------------------- */
/* Scoring a window                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What a window is worth, and the values it was worth it for. Both are kept:
 * the number ranks the clips, the evidence is what a person reads when a clip
 * does badly and wants to know what the machine saw.
 */
export function scoreWindow(input, weights = CLIP_WEIGHTS) {
  const { kind, speech, loudnessRangeLu, shots, positionInEpisode } = input;
  const parts = [
    { name: "kind", value: kind, points: weights.kind[kind] ?? 0 },
    {
      name: "speech density",
      value: speech.density,
      points: Number((speech.density * weights.speechDensity).toFixed(2)),
    },
    {
      name: "loudness range (LU)",
      // No sound measured is not a range of zero: it scores nothing and says so.
      value: loudnessRangeLu,
      points:
        loudnessRangeLu === null ? 0 : Number((loudnessRangeLu * weights.loudnessRangeLu).toFixed(2)),
    },
    {
      name: "picture cuts per minute",
      value: shots.perMinute,
      points: Number((shots.perMinute * weights.shotChangesPerMinute).toFixed(2)),
    },
    {
      name: "position in the episode",
      value: Number(positionInEpisode.toFixed(3)),
      points: Number((positionInEpisode * weights.positionInEpisode).toFixed(2)),
    },
    {
      name: "dialogue characters per second",
      value: speech.charactersPerSecond,
      points: Number((speech.charactersPerSecond * weights.captionCharsPerSecond).toFixed(2)),
    },
  ];
  const score = Number(parts.reduce((sum, part) => sum + part.points, 0).toFixed(2));
  return { score, parts };
}

/* -------------------------------------------------------------------------- */
/* Refusing a window                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Everything that makes a window unpostable, whatever it scored. Returned as
 * issues so a refusal names the clip and the reason, the way the gate does.
 */
export function checkClipWindow(window, context, rules = CLIP_RULES) {
  const { startMs, endMs } = window;
  const { detections, cues, endCard, durationMs } = context;
  const issues = [];
  const seconds = (endMs - startMs) / 1000;

  if (!(endMs > startMs)) {
    return [issue("empty_window", "the window ends before it starts")];
  }
  if (seconds < rules.minSeconds) {
    issues.push(
      issue(
        "clip_too_short",
        `${seconds.toFixed(1)} s is under the ${rules.minSeconds} s a clip needs to be worth posting`,
      ),
    );
  }
  // The file is the window plus the end card, and it is the FILE a platform
  // measures against its cap.
  const maxWindow = rules.maxSeconds - rules.endCardSeconds;
  if (seconds > maxWindow) {
    issues.push(
      issue(
        "clip_too_long",
        `${seconds.toFixed(1)} s plus the ${rules.endCardSeconds} s end card is over the ${rules.maxSeconds} s cap every platform sets`,
      ),
    );
  }
  if (startMs < 0 || endMs > durationMs) {
    issues.push(
      issue(
        "outside_the_episode",
        `${(startMs / 1000).toFixed(1)}-${(endMs / 1000).toFixed(1)} s is outside the ${(durationMs / 1000).toFixed(1)} s episode`,
      ),
    );
  }

  const quiet = quietIn(detections, startMs / 1000, endMs / 1000, durationMs / 1000);
  if (quiet.blackSeconds >= rules.blackMaxSeconds) {
    issues.push(
      issue(
        "black_in_clip",
        `${quiet.blackSeconds.toFixed(2)} s of black picture inside the clip (at most ${rules.blackMaxSeconds} s)`,
      ),
    );
  }
  if (quiet.silenceFraction > rules.silenceMaxFraction) {
    issues.push(
      issue(
        "silent_clip",
        `${(quiet.silenceFraction * 100).toFixed(0)}% of the clip is silent (at most ${(rules.silenceMaxFraction * 100).toFixed(0)}%)`,
      ),
    );
  }
  if (endCard && startMs < endCard.endMs && endMs > endCard.startMs) {
    issues.push(
      issue(
        "covers_end_card",
        `the clip reaches the series' own end card at ${(endCard.startMs / 1000).toFixed(1)} s (${endCard.why})`,
      ),
    );
  }
  const startsInside = cueAt(cues, startMs);
  if (startsInside) {
    issues.push(
      issue(
        "cut_mid_line",
        `the clip starts at ${(startMs / 1000).toFixed(2)} s, in the middle of "${startsInside.text}" (${(startsInside.startMs / 1000).toFixed(2)}-${(startsInside.endMs / 1000).toFixed(2)} s): it would open mid-word`,
      ),
    );
  }
  const endsInside = cueAt(cues, endMs);
  if (endsInside) {
    issues.push(
      issue(
        "cut_mid_line",
        `the clip ends at ${(endMs / 1000).toFixed(2)} s, in the middle of "${endsInside.text}" (${(endsInside.startMs / 1000).toFixed(2)}-${(endsInside.endMs / 1000).toFixed(2)} s): it would cut mid-word`,
      ),
    );
  }
  return issues;
}

/* -------------------------------------------------------------------------- */
/* Proposing the moments of one episode                                        */
/* -------------------------------------------------------------------------- */

function clampWindow(startMs, endMs, durationMs) {
  return { startMs: Math.max(0, Math.round(startMs)), endMs: Math.min(durationMs, Math.round(endMs)) };
}

/**
 * Every moment this episode could give, scored and ranked, with the ones that
 * cannot be posted kept and marked — an episode that gives nothing must be
 * able to say why, or the report reads like the episode was simply skipped.
 *
 * @returns {{ accepted: object[], refused: object[] }}
 */
export function proposeMoments(episode, context, rules = CLIP_RULES, weights = CLIP_WEIGHTS) {
  const { durationMs, episodeNumber } = episode;
  const { cues, scenes, detections, loudness } = context;
  const durationSeconds = durationMs / 1000;
  const endCard = endCardRegion(detections, durationMs, cues, rules);
  const storyEndMs = endCard ? endCard.startMs : durationMs;

  const candidates = [];
  const add = (kind, rawStartMs, rawEndMs, notes) => {
    const clamped = clampWindow(rawStartMs, rawEndMs, durationMs);
    if (clamped.endMs <= clamped.startMs) return;
    candidates.push({ kind, ...clamped, notes: notes ?? [] });
  };

  /* --- the cliffhanger: back from the last beat of the story --- */
  {
    const notes = [];
    let endMs = storyEndMs - rules.holdBackSeconds * 1000;
    notes.push(
      `held back ${rules.holdBackSeconds} s from ${endCard ? "the end card" : "the last frame"} so the clip stops before the resolution`,
    );
    const snappedEnd = snapToLineEnd(endMs, cues, rules);
    if (snappedEnd.snapped) {
      endMs = snappedEnd.ms;
      notes.push(`moved ${(snappedEnd.distance / 1000).toFixed(2)} s onto the end of a line`);
    }
    const want = Math.min(rules.cliffhangerMaxSeconds * 1000, endMs);
    const least = rules.cliffhangerMinSeconds * 1000;
    const length = Math.max(Math.min(want, endMs), Math.min(least, endMs));
    let startMs = endMs - length;
    const snappedStart = snapToShotChange(startMs / 1000, scenes, rules);
    if (snappedStart.snapped && endMs - snappedStart.seconds * 1000 >= rules.minSeconds * 1000) {
      startMs = snappedStart.seconds * 1000;
      notes.push(`start moved ${snappedStart.distance.toFixed(2)} s onto a picture cut`);
    }
    const startLine = snapToLineEnd(startMs, cues, rules);
    if (startLine.snapped) {
      startMs = startLine.ms;
      notes.push(`start moved ${(startLine.distance / 1000).toFixed(2)} s off the middle of a line`);
    }
    add("cliffhanger", startMs, endMs, notes);
  }

  /* --- the cold open: only episode 1 carries the premise --- */
  if (episodeNumber === 1) {
    const notes = ["the first seconds of episode 1: the premise a stranger needs"];
    let endMs = Math.min(rules.coldOpenMaxSeconds * 1000, storyEndMs);
    const snappedEnd = snapToLineEnd(endMs, cues, rules);
    if (snappedEnd.snapped) {
      endMs = snappedEnd.ms;
      notes.push(`end moved ${(snappedEnd.distance / 1000).toFixed(2)} s onto the end of a line`);
    }
    add("coldOpen", 0, endMs, notes);
  }

  /* --- dialogue peaks: a window slid across the episode --- */
  {
    const step = rules.peakStepSeconds * 1000;
    const lengths = [rules.peakMinSeconds, rules.peakMaxSeconds].map((value) => value * 1000);
    for (const length of new Set(lengths)) {
      for (let startMs = 0; startMs + length <= storyEndMs; startMs += step) {
        const notes = ["a window slid across the episode"];
        let start = startMs;
        let end = startMs + length;
        const snappedStart = snapToShotChange(start / 1000, scenes, rules);
        if (snappedStart.snapped) {
          start = snappedStart.seconds * 1000;
          notes.push(`start on a picture cut (${snappedStart.distance.toFixed(2)} s away)`);
        }
        const startLine = snapToLineEnd(start, cues, rules);
        if (startLine.snapped) start = startLine.ms;
        const endLine = snapToLineEnd(end, cues, rules);
        if (endLine.snapped) {
          end = endLine.ms;
          notes.push(`end on the end of a line (${(endLine.distance / 1000).toFixed(2)} s away)`);
        }
        add("dialoguePeak", start, end, notes);
      }
    }
  }

  const accepted = [];
  const refused = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.startMs}:${candidate.endMs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const issues = checkClipWindow(candidate, { detections, cues, endCard, durationMs }, rules);
    const speech = speechIn(cues, candidate.startMs, candidate.endMs);
    const shots = shotChangesIn(scenes, candidate.startMs / 1000, candidate.endMs / 1000);
    const loudnessRangeLu = loudnessRangeIn(loudness, candidate.startMs / 1000, candidate.endMs / 1000);
    const positionInEpisode = durationMs > 0 ? candidate.startMs / durationMs : 0;
    const scored = scoreWindow(
      { kind: candidate.kind, speech, loudnessRangeLu, shots, positionInEpisode },
      weights,
    );
    const moment = {
      ...candidate,
      episodeNumber,
      seconds: Number(((candidate.endMs - candidate.startMs) / 1000).toFixed(3)),
      score: scored.score,
      evidence: {
        parts: scored.parts,
        speech,
        shots,
        loudnessRangeLu,
        quiet: quietIn(detections, candidate.startMs / 1000, candidate.endMs / 1000, durationSeconds),
        endCard,
      },
    };
    if (issues.length > 0) refused.push({ ...moment, issues });
    else accepted.push(moment);
  }

  accepted.sort(
    (a, b) => b.score - a.score || CLIP_KINDS.indexOf(a.kind) - CLIP_KINDS.indexOf(b.kind) || a.startMs - b.startMs,
  );
  return { accepted, refused, endCard };
}

/**
 * Two moments of the same episode that share most of their seconds are one
 * moment posted twice. Keeps the better, in score order.
 */
export function dropOverlapping(moments, maxOverlapFraction = 0.5) {
  const kept = [];
  for (const moment of moments) {
    const clash = kept.find((other) => {
      if (other.episodeNumber !== moment.episodeNumber) return false;
      const overlap = Math.min(other.endMs, moment.endMs) - Math.max(other.startMs, moment.startMs);
      if (overlap <= 0) return false;
      const shortest = Math.min(other.endMs - other.startMs, moment.endMs - moment.startMs);
      return shortest > 0 && overlap / shortest > maxOverlapFraction;
    });
    if (!clash) kept.push(moment);
  }
  return kept;
}

/* -------------------------------------------------------------------------- */
/* Identity, rhythm and memory                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A clip's identity: which seconds of which episode of which series, under
 * which rules. It does not depend on the rendered bytes, so the same moment
 * asked for twice is recognised as already produced — that is what lets a
 * second run continue instead of repeating.
 */
export function clipIdentity({ seriesSlug, episodeNumber, startMs, endMs }) {
  const canonical = JSON.stringify({
    clipRulesVersion: CLIP_RULES_VERSION,
    seriesSlug,
    episodeNumber,
    startMs,
    endMs,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** The short code a link carries and a file is named by: the first 8 of the identity. */
export function clipCode(identity) {
  return String(identity).slice(0, 8);
}

/**
 * The order a day of clips is posted in: never the same episode twice in a
 * row. Takes the best moments first and walks the episodes round-robin, so a
 * five-episode series alternates instead of emptying episode 5.
 */
export function spreadByEpisode(moments) {
  const byEpisode = new Map();
  for (const moment of moments) {
    const list = byEpisode.get(moment.episodeNumber) ?? [];
    list.push(moment);
    byEpisode.set(moment.episodeNumber, list);
  }
  for (const list of byEpisode.values()) list.sort((a, b) => b.score - a.score);
  // Episodes with the most to give go first, so the round-robin does not run
  // dry on one of them while another still has three good moments left.
  const queues = [...byEpisode.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
    .map(([episodeNumber, list]) => ({ episodeNumber, list }));
  const out = [];
  let previousEpisode = null;
  while (queues.some((queue) => queue.list.length > 0)) {
    // The best moment available from an episode that is not the last one used.
    let pick = null;
    for (const queue of queues) {
      if (queue.list.length === 0) continue;
      if (queue.episodeNumber === previousEpisode) continue;
      if (pick === null || queue.list[0].score > pick.list[0].score) pick = queue;
    }
    // Only one episode left with anything in it: it is that or nothing.
    if (pick === null) pick = queues.find((queue) => queue.list.length > 0);
    out.push(pick.list.shift());
    previousEpisode = pick.episodeNumber;
  }
  return out;
}

/** "2026-09-24" plus n days, as the same kind of string. */
export function addDays(isoDate, days) {
  const base = new Date(`${isoDate}T00:00:00.000Z`);
  if (!Number.isFinite(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * A day, or a week, of clips: `perDay` on each day from `startDate`. The order
 * is the one spreadByEpisode produced, so each day is a mix of episodes.
 */
export function scheduleClips(moments, { perDay, startDate }) {
  if (!Number.isInteger(perDay) || perDay < 1) {
    throw new Error(`perDay must be a whole number of clips a day, got ${String(perDay)}`);
  }
  return moments.map((moment, index) => ({
    ...moment,
    day: Math.floor(index / perDay),
    scheduledFor: addDays(startDate, Math.floor(index / perDay)),
    positionInDay: (index % perDay) + 1,
  }));
}

/**
 * What a second run must not make again. `produced` is the clips.json of an
 * earlier run: the output folder IS the memory, so deleting the clips is also
 * how you ask for them again.
 */
export function withoutProduced(moments, produced) {
  const made = new Set((produced ?? []).map((clip) => clip.identity));
  return moments.filter((moment) => !made.has(moment.identity));
}

/* -------------------------------------------------------------------------- */
/* The words under the clip                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The tracking link, built for what the APP really accepts. `parseShareStartMs`
 * in the web app takes `t` only as 1-5 digits, above zero, and at least
 * SHARE_END_MARGIN_MS before the end of the episode — a cliffhanger moment
 * near the last second would have its `t` silently ignored, so the link points
 * at the start of the moment and says when it could not carry one at all.
 */
export const SHARE_END_MARGIN_MS = 2_000;

export function buildClipLink({
  siteUrl,
  seriesSlug,
  episodeSlug,
  startMs,
  episodeDurationMs,
  platform,
  code,
}) {
  const definition = PLATFORMS[platform];
  if (!definition) throw new Error(`unknown platform "${String(platform)}"`);
  const base = String(siteUrl).replace(/\/$/, "");
  const url = new URL(`${base}/watch/${seriesSlug}/${episodeSlug}`);
  url.searchParams.set("utm_source", definition.utmSource);
  url.searchParams.set("utm_medium", "clip");
  url.searchParams.set("utm_campaign", `clip-${code}`);
  const startSeconds = Math.floor(startMs / 1000);
  let openedAt = null;
  let whyNoStart = null;
  if (startSeconds < 1) {
    whyNoStart = "the moment starts at the first second: the link opens the episode at its start";
  } else if (startSeconds > 99_999) {
    whyNoStart =
      "the moment starts past the 5 digits the app reads from t: the link opens the episode at its start";
  } else if (startMs >= episodeDurationMs - SHARE_END_MARGIN_MS) {
    whyNoStart = `the moment starts within ${SHARE_END_MARGIN_MS / 1000} s of the end, which the app ignores: the link opens the episode at its start`;
  } else {
    url.searchParams.set("t", String(startSeconds));
    openedAt = startSeconds;
  }
  return { url: url.toString(), openedAtSeconds: openedAt, whyNoStart };
}

/** A tag list with no repeats, in the order it was built. */
function uniqueTags(tags) {
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    const clean = String(tag).replace(/[^\p{L}\p{N}]/gu, "");
    if (clean.length === 0) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/** The platform's own tags, then the series' genres and tropes, mapped. */
export function hashtagsFor(platform, { genres = [], tropes = [] } = {}) {
  const definition = PLATFORMS[platform];
  if (!definition) throw new Error(`unknown platform "${String(platform)}"`);
  const fromGenres = genres.flatMap((genre) => GENRE_HASHTAGS[String(genre).toLowerCase()] ?? []);
  const fromTropes = tropes.flatMap((trope) => TROPE_HASHTAGS[String(trope).toLowerCase()] ?? []);
  return uniqueTags([...definition.hashtags, ...fromGenres, ...fromTropes]).map((tag) => `#${tag}`);
}

/** The first line of a hook, trimmed. Hooks are delivered with a line break in them. */
export function firstLine(text) {
  const line = String(text ?? "").split("\n")[0].trim();
  return line.length > 0 ? line : null;
}

/**
 * The description, from the series' own words and fixed fragments. Nothing is
 * invented: the sentence is the episode's hook as the studio delivered it, the
 * promise is the one in COPY, and the link is the one built above. When a
 * hook is missing the sentence is simply left out — a plausible replacement is
 * read by strangers as a claim.
 *
 * Hashtags are dropped from the end, never the link or the sentence, when the
 * platform's limit is reached.
 */
export function describeClip({
  platform,
  seriesTitle,
  episodeNumber,
  hook,
  link,
  hashtags,
  standIn = null,
}) {
  const definition = PLATFORMS[platform];
  if (!definition) throw new Error(`unknown platform "${String(platform)}"`);
  const sentence = firstLine(hook);
  const head = [`${seriesTitle} — ${COPY.episodeLabel(episodeNumber)}`];
  if (sentence) head.push(sentence);
  head.push(COPY.freePromise);
  if (definition.linkPlacement === "bio") head.push(COPY.linkInBio);
  else head.push(`${COPY.watchPrefix} ${link}`);
  if (standIn) head.push(standIn.label);
  const body = head.join("\n");

  const tags = [...hashtags];
  let text = tags.length > 0 ? `${body}\n\n${tags.join(" ")}` : body;
  while (text.length > definition.maxTextLength && tags.length > 0) {
    tags.pop();
    text = tags.length > 0 ? `${body}\n\n${tags.join(" ")}` : body;
  }
  const result = { text, hashtags: tags, linkPlacement: definition.linkPlacement };
  if (definition.maxTitleLength) {
    // YouTube shows a title above the Short: the series and the episode, cut on
    // a word if the series' name is long, never mid-word.
    const wanted = sentence
      ? `${seriesTitle} — ${COPY.episodeLabel(episodeNumber)}: ${sentence}`
      : `${seriesTitle} — ${COPY.episodeLabel(episodeNumber)}`;
    result.title = fitOnWord(wanted, definition.maxTitleLength);
  }
  return result;
}

/** Cuts to a length on a word boundary, with an ellipsis. Never mid-word. */
export function fitOnWord(text, maxLength) {
  const value = String(text);
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}\u2026`;
}

/* -------------------------------------------------------------------------- */
/* The text burned into the picture                                            */
/* -------------------------------------------------------------------------- */

/**
 * The area the platform's own interface does NOT cover, in pixels. Nothing we
 * draw may cross it, and the caller proves it by measuring the rendered
 * frames, not by trusting these numbers.
 */
export function safeArea(width, height, rules = CLIP_RULES) {
  return {
    left: Math.round(width * rules.uiLeftFraction),
    right: Math.round(width * (1 - rules.uiRightFraction)),
    top: Math.round(height * rules.uiTopFraction),
    bottom: Math.round(height * (1 - rules.uiBottomFraction)),
  };
}

/** Is a measured box of drawn pixels entirely inside the safe area? */
export function insideSafeArea(box, safe) {
  if (box === null) return { inside: true, outsideBy: null };
  const outside = {
    left: Math.max(0, safe.left - box.left),
    right: Math.max(0, box.right - safe.right),
    top: Math.max(0, safe.top - box.top),
    bottom: Math.max(0, box.bottom - safe.bottom),
  };
  const worst = Math.max(outside.left, outside.right, outside.top, outside.bottom);
  return { inside: worst === 0, outsideBy: worst === 0 ? null : outside };
}

/**
 * The smallest box holding every pixel brighter than `threshold` in a grey
 * frame. This is how the text is found: the same subtitles drawn over black,
 * so anything not black IS the text.
 */
export function boundingBoxOfBright(gray, width, height, threshold = 24) {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (gray[row + x] <= threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return { left, top, right, bottom };
}

/** The union of two measured boxes; either may be null. */
export function unionBox(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/** sRGB relative luminance (WCAG 2.1). */
export function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast between two luminances, lighter first or not. */
export function contrastRatio(a, b) {
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return Number(((light + 0.05) / (dark + 0.05)).toFixed(2));
}

/**
 * Splits a line of dialogue over as few lines as `maxChars` allows, as evenly
 * as the words allow, and says whether it needed more than `maxLines`.
 *
 * It NEVER drops a word. Returning only the first two lines of a three-line
 * caption would put half a sentence on screen under the half that is being
 * spoken, and nothing would say so. When the words need a third line the
 * caller shrinks the type — which raises maxChars — and asks again.
 */
export function wrapLines(text, maxChars, maxLines = CLIP_RULES.captionMaxLines) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [], overflow: false };
  let lines = [""];
  for (const word of words) {
    const current = lines[lines.length - 1];
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= maxChars || current.length === 0) {
      lines[lines.length - 1] = candidate;
    } else {
      lines.push(word);
    }
  }
  // Two lines look better balanced than filled: move words back while it helps.
  if (lines.length === 2) {
    const balanced = balanceTwo(words, maxChars);
    if (balanced) lines = balanced;
  }
  return { lines, overflow: lines.length > maxLines };
}

function balanceTwo(words, maxChars) {
  let best = null;
  for (let split = 1; split < words.length; split += 1) {
    const first = words.slice(0, split).join(" ");
    const second = words.slice(split).join(" ");
    if (first.length > maxChars || second.length > maxChars) continue;
    const difference = Math.abs(first.length - second.length);
    if (best === null || difference < best.difference) best = { difference, lines: [first, second] };
  }
  return best ? best.lines : null;
}

/** ASS reads a backslash and a brace as markup; a line of dialogue must not. */
export function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, "\u2216")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, " ")
    .trim();
}

/** Seconds → "0:00:01.23", the only time format ASS takes. */
export function assTime(seconds) {
  const total = Math.max(0, Math.round(seconds * 100));
  const centis = total % 100;
  const whole = Math.floor(total / 100);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(centis)}`;
}

/** #RRGGBB → the &HAABBGGRR an ASS style wants. Opaque, always. */
export function assColour(hex) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!match) throw new Error(`"${String(hex)}" is not a #rrggbb colour`);
  const [, r, g, b] = match;
  return `&H00${b}${g}${r}`.toUpperCase();
}

/**
 * The look of the burned-in text. The caption plate is OPAQUE on purpose: a
 * translucent one takes its contrast from whatever frame is behind it, which
 * is exactly the thing nobody can check before posting. Opaque means the
 * contrast is the same over a white wall and a night street, and it is the
 * number measured in the proof.
 */
export const CLIP_THEME = {
  text: "#FAF8F4",
  plate: "#08080A",
  endCardBackground: "#0B0B0F",
  endCardAccent: "#F4C77B",
  captionFontSize: 58,
  hookFontSize: 68,
  endCardTitleSize: 88,
  endCardLineSize: 50,
  endCardAddressSize: 48,
  /** Padding of the opaque plate, in ASS outline units. */
  platePadding: 16,
};

/**
 * The whole subtitle track of one clip, as ASS: the hook in the first seconds,
 * the episode's own lines retimed to the clip, and the end card. libass draws
 * it; nothing is composed with drawtext, whose escaping of a colon or an
 * apostrophe inside real dialogue is a source of silent breakage.
 *
 * `scale` shrinks every size at once, which is how the caller makes the text
 * fit the safe area: it renders, measures, shrinks, renders again.
 */
export function buildAssScript({
  cues,
  hookLine,
  endCard,
  clipSeconds,
  rules = CLIP_RULES,
  theme = CLIP_THEME,
  fontName,
  scale = 1,
  maxChars = 26,
}) {
  const safe = safeArea(rules.width, rules.height, rules);
  /*
   * The opaque plate grows out of the text by its padding on every side, so
   * the margins have to pay for it: a margin equal to the safe area puts the
   * PLATE outside it by exactly the padding. Shrinking the type does not fix
   * that — the padding does not shrink with it — which is why it is added
   * here rather than left to the fitting loop to discover.
   */
  const pad = theme.platePadding;
  const marginL = safe.left + pad;
  const marginR = rules.width - safe.right + pad;
  const hookMarginV = safe.top + pad;
  // ASS measures a bottom margin from the bottom of the frame; the caption
  // block must clear the platform's own interface and its own plate.
  const captionMarginV = Math.max(
    Math.round(rules.height * (1 - rules.captionBaselineFraction)),
    rules.height - safe.bottom + pad,
  );
  const size = (value) => Math.max(18, Math.round(value * scale));
  /*
   * Smaller type fits more characters on the same line, so the limit moves
   * with it. That is what lets the fitting loop solve a caption that wanted a
   * third line: it shrinks, the line gets longer, two lines are enough.
   */
  const charsPerLine = Math.max(12, Math.round(maxChars / scale));
  let overflowing = 0;

  const styles = [
    styleLine("Caption", fontName, size(theme.captionFontSize), theme, 2, marginL, marginR, captionMarginV, 0),
    styleLine("Hook", fontName, size(theme.hookFontSize), theme, 8, marginL, marginR, hookMarginV, 1),
    styleLine("CardTitle", fontName, size(theme.endCardTitleSize), theme, 5, marginL, marginR, 0, 1, true),
    styleLine("CardLine", fontName, size(theme.endCardLineSize), theme, 5, marginL, marginR, 0, 0, true),
    styleLine("CardAddress", fontName, size(theme.endCardAddressSize), theme, 5, marginL, marginR, 0, 1, true),
  ];

  const events = [];
  /*
   * The instant halfway through each event. Measuring one frame per event is
   * the whole union of drawn pixels and nothing more: a frame taken inside an
   * event contains that event's box, so the union over every event's midpoint
   * is exactly the union over time — at a handful of frames instead of a grid
   * dense enough not to step over a short line.
   */
  const sampleTimes = [];
  const push = (style, startSeconds, endSeconds, text, override = "") => {
    if (endSeconds <= startSeconds) return;
    events.push(
      `Dialogue: 0,${assTime(startSeconds)},${assTime(endSeconds)},${style},,0,0,0,,${override}${text}`,
    );
    sampleTimes.push(Number(((startSeconds + endSeconds) / 2).toFixed(3)));
  };

  if (hookLine) {
    const wrapped = wrapLines(escapeAssText(hookLine), charsPerLine, rules.captionMaxLines);
    if (wrapped.overflow) overflowing += 1;
    push("Hook", 0, Math.min(rules.hookSeconds, clipSeconds), wrapped.lines.join("\\N"));
  }
  for (const cue of cues) {
    const wrapped = wrapLines(escapeAssText(cue.text), charsPerLine, rules.captionMaxLines);
    if (wrapped.lines.length === 0) continue;
    if (wrapped.overflow) overflowing += 1;
    push("Caption", cue.startSeconds, Math.min(cue.endSeconds, clipSeconds), wrapped.lines.join("\\N"));
  }
  if (endCard) {
    const from = clipSeconds;
    const to = clipSeconds + rules.endCardSeconds;
    /*
     * Four blocks stacked around the middle of the safe area, tight enough to
     * read as one card. The positions are absolute because the card has its
     * own composition, not the subtitles' one; they sit well inside the safe
     * area and the caller measures that they did.
     */
    const middle = Math.round((safe.top + safe.bottom) / 2);
    push("CardTitle", from, to, escapeAssText(endCard.title), `{\\pos(540,${middle - 60})}`);
    push("CardLine", from, to, escapeAssText(endCard.promise), `{\\pos(540,${middle + 70})}`);
    push(
      "CardAddress",
      from,
      to,
      escapeAssText(endCard.address),
      `{\\pos(540,${middle + 180})\\c${assColour(theme.endCardAccent)}}`,
    );
    if (endCard.note) {
      push("CardLine", from, to, escapeAssText(endCard.note), `{\\pos(540,${middle + 320})\\fscx70\\fscy70}`);
    }
  }

  const script = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${rules.width}`,
    `PlayResY: ${rules.height}`,
    // 0 wraps a line that does not fit the margins, so text can never spill
    // out of the safe area sideways; the caller still measures that it did not.
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
  return { script, sampleTimes, events: events.length, safe, typeScale: scale, overflowing, charsPerLine };
}

function styleLine(name, fontName, fontSize, theme, alignment, marginL, marginR, marginV, bold, plain = false) {
  const text = assColour(theme.text);
  const plate = assColour(plain ? theme.endCardBackground : theme.plate);
  // BorderStyle 3 is the opaque plate; on the card the background is already
  // the plate colour, so the box is invisible and the text simply sits on it.
  return [
    `Style: ${name}`,
    fontName,
    String(fontSize),
    text,
    text,
    plate,
    plate,
    String(bold),
    "0",
    "0",
    "0",
    "100",
    "100",
    "0",
    "0",
    "3",
    String(plain ? 0 : theme.platePadding),
    "0",
    String(alignment),
    String(marginL),
    String(marginR),
    String(marginV),
    "1",
  ].join(",");
}

/**
 * The episode's cues, cut to the clip and retimed to start at zero. A cue that
 * only half overlaps the clip is kept and clipped, never dropped: the words
 * on screen must match the words being spoken.
 */
export function cuesForClip(cues, startMs, endMs) {
  const out = [];
  for (const cue of cues) {
    const from = Math.max(cue.startMs, startMs);
    const to = Math.min(cue.endMs, endMs);
    if (to <= from) continue;
    if (cue.text.trim().length === 0) continue;
    out.push({
      startSeconds: Number(((from - startMs) / 1000).toFixed(3)),
      endSeconds: Number(((to - startMs) / 1000).toFixed(3)),
      text: cue.text,
    });
  }
  return out;
}

/**
 * The line shown in the first second. It must be something somebody really
 * wrote: the first thing said inside the clip, or the episode's own hook.
 * Never a sentence composed for the occasion.
 */
export function hookLineFor({ cues, startMs, episodeHook, seriesHook }) {
  const firstInside = cues.find((cue) => cue.endMs > startMs && cue.text.trim().length > 0);
  if (firstInside && firstInside.startMs - startMs < 4000) {
    return { text: firstInside.text.trim(), from: "the first line spoken in the clip" };
  }
  const episode = firstLine(episodeHook);
  if (episode) return { text: episode, from: "the episode's hook in series.json" };
  const series = firstLine(seriesHook);
  if (series) return { text: series, from: "the series' hook in series.json" };
  return null;
}
