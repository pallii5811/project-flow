/**
 * The technical quality gate, as pure functions (CP-2).
 *
 * ffmpeg and ffprobe are run by the caller (scripts/package-episode.mjs);
 * everything decided here is decided on text, so every rule is unit-tested in
 * test/content-pipeline.test.ts instead of being believed.
 *
 * A rule exists only because a viewer would feel it:
 *
 *   - loudness: two series delivered 12 LU apart make the volume jump on
 *     every swipe, and the viewer who turned the sound on turns it off;
 *   - audio present, and not silent: an episode that ships without dialogue
 *     is unwatchable in a feed that most people open muted;
 *   - black or frozen opening: the first second is the whole hook; later in
 *     the episode only a still far longer than any shot is a frozen master;
 *   - shape and length: a horizontal, low or six-minute "episode" breaks the
 *     feed it is swiped into;
 *   - the same master twice: a duplicate episode looks like a bug to the
 *     viewer and pays the producer twice.
 *
 * Every check returns issues as { code, message }. An empty array is the only
 * way to pass.
 */

/** Values the gate enforces. A series may narrow the length range, never the rest. */
export const QUALITY_RULES = {
  aspectMin: 0.45,
  aspectMax: 0.65,
  /** The curation gate (docs/business-model.md). Stand-in packs declare an exception. */
  minHeight: 1920,
  fpsMin: 23,
  fpsMax: 61,
  /** Default episode length for short drama; a series may set its own. */
  durationMinMs: 30_000,
  durationMaxMs: 180_000,
  /** EBU R128 target for every episode of every series. */
  targetLufs: -16,
  /** Tolerance on the measured loudness of the published audio. */
  lufsToleranceLu: 1,
  truePeakDbMax: -0.5,
  /** The opening the gate looks at, in seconds. */
  openingSeconds: 5,
  /** Black or silence at least this long inside the opening fails. */
  blackOpeningMaxSeconds: 0.5,
  silenceOpeningMaxSeconds: 2.5,
  /** A still picture this long inside the opening: the hook does not move. */
  freezeOpeningMaxSeconds: 1.5,
  /**
   * After the opening a still picture is a shot — a text message on a phone,
   * a fade to black, an end card, a freeze-frame cliffhanger — until it lasts
   * this long. Past it, the master itself froze.
   */
  freezeMaxSeconds: 10,
  /** More silence than this over the whole episode: no dialogue track. */
  silenceTotalMaxFraction: 0.5,
};

function issue(code, message) {
  return { code, message };
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The JSON block printed by `loudnorm ... print_format=json` (first pass).
 * Returns null when the block is absent: no measurement is not a measurement
 * of zero, and the caller must fail instead of encoding blind.
 */
export function parseLoudnormJson(text) {
  const matches = String(text).match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!matches || matches.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(matches[matches.length - 1]);
  } catch {
    return null;
  }
  const measured = {
    inputI: finite(parsed.input_i),
    inputTp: finite(parsed.input_tp),
    inputLra: finite(parsed.input_lra),
    inputThresh: finite(parsed.input_thresh),
    targetOffset: finite(parsed.target_offset),
  };
  for (const value of Object.values(measured)) {
    if (value === null) return null;
  }
  return measured;
}

/** The summary block printed by the ebur128 filter. null when it is not there. */
export function parseEbur128Summary(text) {
  const source = String(text);
  const integrated = /Integrated loudness:\s*[\r\n]+\s*I:\s*(-?[\d.]+|-inf)\s*LUFS/i.exec(source);
  const range = /Loudness range:\s*[\r\n]+\s*LRA:\s*(-?[\d.]+)\s*LU/i.exec(source);
  const peak = /True peak:\s*[\r\n]+\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS/i.exec(source);
  if (!integrated || !peak) return null;
  const integratedLufs = integrated[1] === "-inf" ? -70 : finite(integrated[1]);
  const truePeakDb = peak[1] === "-inf" ? -70 : finite(peak[1]);
  if (integratedLufs === null || truePeakDb === null) return null;
  return {
    integratedLufs,
    loudnessRangeLu: range ? (finite(range[1]) ?? 0) : 0,
    truePeakDb,
  };
}

/** blackdetect, freezedetect and silencedetect lines, in seconds. */
export function parseDetections(text) {
  const source = String(text);
  const black = [];
  for (const match of source.matchAll(
    /black_start:\s*(-?[\d.]+)\s+black_end:\s*(-?[\d.]+)\s+black_duration:\s*([\d.]+)/g,
  )) {
    black.push({
      start: Number(match[1]),
      end: Number(match[2]),
      duration: Number(match[3]),
    });
  }

  const freeze = [];
  const freezeStarts = [...source.matchAll(/freeze_start:\s*(-?[\d.]+)/g)].map((m) =>
    Number(m[1]),
  );
  const freezeDurations = [...source.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) =>
    Number(m[1]),
  );
  for (let i = 0; i < freezeStarts.length; i += 1) {
    freeze.push({
      start: freezeStarts[i],
      // A freeze still running at the end of the file has no duration line.
      duration: i < freezeDurations.length ? freezeDurations[i] : null,
    });
  }

  const silence = [];
  const silenceStarts = [...source.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) =>
    Number(m[1]),
  );
  const silenceEnds = [
    ...source.matchAll(/silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g),
  ].map((m) => ({ end: Number(m[1]), duration: Number(m[2]) }));
  for (let i = 0; i < silenceStarts.length; i += 1) {
    const closed = silenceEnds[i];
    silence.push({
      start: silenceStarts[i],
      end: closed ? closed.end : null,
      duration: closed ? closed.duration : null,
    });
  }

  return { black, freeze, silence };
}

/** Shape of the delivered master: vertical, tall enough, sane frame rate and length. */
export function checkMasterShape(probe, options = {}) {
  const rules = { ...QUALITY_RULES, ...(options.rules ?? {}) };
  const issues = [];
  const { width, height, fps, durationMs } = probe;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    issues.push(issue("unreadable_dimensions", `unreadable picture size: ${width}x${height}`));
    return issues;
  }
  const aspect = width / height;
  if (aspect < rules.aspectMin || aspect > rules.aspectMax) {
    issues.push(
      issue(
        "not_vertical",
        `${width}x${height} is aspect ${aspect.toFixed(3)}; vertical means ${rules.aspectMin}-${rules.aspectMax}`,
      ),
    );
  }
  if (height < rules.minHeight && options.allowBelow1080p !== true) {
    issues.push(
      issue(
        "below_curation_height",
        `master is ${width}x${height}; the curation gate requires at least 1080x${rules.minHeight}`,
      ),
    );
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    issues.push(issue("unreadable_fps", `unreadable frame rate: ${fps}`));
  } else if (fps < rules.fpsMin || fps > rules.fpsMax) {
    issues.push(
      issue("unusual_fps", `${fps.toFixed(3)} fps is outside ${rules.fpsMin}-${rules.fpsMax}`),
    );
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    issues.push(issue("unreadable_duration", `unreadable duration: ${durationMs}`));
  } else {
    const min = options.durationMinMs ?? rules.durationMinMs;
    const max = options.durationMaxMs ?? rules.durationMaxMs;
    if (durationMs < min || durationMs > max) {
      issues.push(
        issue(
          "duration_out_of_range",
          `${(durationMs / 1000).toFixed(2)} s is outside the ${(min / 1000).toFixed(0)}-${(max / 1000).toFixed(0)} s this series declares`,
        ),
      );
    }
  }
  return issues;
}

/**
 * Which audio stream carries the dialogue. With several streams the delivery
 * must say which one: guessing ships the music-and-effects stem.
 */
export function chooseAudioStream(streams, requestedIndex = null) {
  const audio = streams.filter((stream) => stream.codec_type === "audio");
  if (audio.length === 0) {
    return {
      index: null,
      issues: [issue("no_audio", "the master has no audio stream: it would ship silent")],
    };
  }
  if (requestedIndex !== null && requestedIndex !== undefined) {
    if (!Number.isInteger(requestedIndex) || requestedIndex < 0 || requestedIndex >= audio.length) {
      return {
        index: null,
        issues: [
          issue(
            "audio_stream_out_of_range",
            `audioStream ${requestedIndex} does not exist: the master has ${audio.length} audio streams`,
          ),
        ],
      };
    }
    return { index: requestedIndex, issues: [] };
  }
  if (audio.length > 1) {
    const described = audio
      .map((stream, i) => `${i}: ${stream.channels ?? "?"} ch ${stream.tags?.language ?? "und"}`)
      .join(", ");
    return {
      index: null,
      issues: [
        issue(
          "ambiguous_audio",
          `${audio.length} audio streams (${described}); the delivery must name the dialogue one with audioStream`,
        ),
      ],
    };
  }
  return { index: 0, issues: [] };
}

/** Black, frozen or silent where the viewer would notice: the opening, and the whole file. */
export function checkPicture(detections, durationMs, options = {}) {
  const rules = { ...QUALITY_RULES, ...(options.rules ?? {}) };
  const issues = [];
  const openingEnd = rules.openingSeconds;

  for (const range of detections.black) {
    const insideOpening = Math.min(range.end, openingEnd) - Math.max(range.start, 0);
    if (insideOpening >= rules.blackOpeningMaxSeconds) {
      issues.push(
        issue(
          "black_opening",
          `${insideOpening.toFixed(2)} s of black picture in the first ${openingEnd} s (from ${range.start.toFixed(2)} s): no hook`,
        ),
      );
      break;
    }
  }

  // Two different questions. In the opening, any still picture longer than a
  // beat costs the hook. Later, a still picture is a shot — short drama ends
  // on fades, end cards and freeze-frames — and only a still far longer than
  // any shot means the master froze.
  for (const range of detections.freeze) {
    const duration = range.duration ?? Math.max(0, durationMs / 1000 - range.start);
    const end = range.start + duration;
    const insideOpening = Math.min(end, openingEnd) - Math.max(range.start, 0);
    if (insideOpening >= rules.freezeOpeningMaxSeconds) {
      issues.push(
        issue(
          "frozen_opening",
          `the picture is still for ${insideOpening.toFixed(2)} s in the first ${openingEnd} s (from ${range.start.toFixed(2)} s): no hook`,
        ),
      );
      break;
    }
    if (duration >= rules.freezeMaxSeconds) {
      issues.push(
        issue(
          "frozen_picture",
          `the picture is still for ${duration.toFixed(2)} s from ${range.start.toFixed(2)} s: longer than any shot, the master froze`,
        ),
      );
      break;
    }
  }

  return issues;
}

/**
 * The picture as the viewer sees it. Phones and some editors store a vertical
 * picture as landscape pixels plus a rotation flag (or the reverse); ffmpeg
 * applies the flag when it decodes, so the shape rules must too — otherwise a
 * landscape picture passes as vertical and ships landscape renditions.
 */
export function displayDimensions(stream) {
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  let rotation = 0;
  for (const entry of stream?.side_data_list ?? []) {
    const value = Number(entry?.rotation);
    if (Number.isFinite(value) && value !== 0) rotation = value;
  }
  const tagged = Number(stream?.tags?.rotate);
  if (rotation === 0 && Number.isFinite(tagged)) rotation = tagged;
  const quarterTurns = Math.round(rotation / 90);
  const normalized = (((quarterTurns % 4) + 4) % 4) * 90;
  const swapped = normalized === 90 || normalized === 270;
  return {
    width: swapped ? height : width,
    height: swapped ? width : height,
    rotation: normalized,
  };
}

/** Silence where dialogue should be. */
export function checkSilence(detections, durationMs, options = {}) {
  const rules = { ...QUALITY_RULES, ...(options.rules ?? {}) };
  const issues = [];
  const seconds = durationMs / 1000;

  let totalSilence = 0;
  for (const range of detections.silence) {
    const end = range.end ?? seconds;
    const duration = range.duration ?? Math.max(0, end - range.start);
    totalSilence += duration;
    const insideOpening = Math.min(end, rules.openingSeconds) - Math.max(range.start, 0);
    if (insideOpening >= rules.silenceOpeningMaxSeconds) {
      issues.push(
        issue(
          "silent_opening",
          `${insideOpening.toFixed(2)} s of silence in the first ${rules.openingSeconds} s (from ${range.start.toFixed(2)} s)`,
        ),
      );
    }
  }
  if (seconds > 0 && totalSilence / seconds > rules.silenceTotalMaxFraction) {
    issues.push(
      issue(
        "mostly_silent",
        `${((totalSilence / seconds) * 100).toFixed(0)}% of the episode is silent: this is not a dialogue track`,
      ),
    );
  }
  return issues;
}

/** The loudness of the audio that will actually be published. */
export function checkPublishedLoudness(measured, options = {}) {
  const rules = { ...QUALITY_RULES, ...(options.rules ?? {}) };
  if (!measured) {
    return [
      issue(
        "loudness_unmeasured",
        "the loudness of the packaged audio could not be measured: nothing proves it is normalised",
      ),
    ];
  }
  const issues = [];
  const off = Math.abs(measured.integratedLufs - rules.targetLufs);
  if (off > rules.lufsToleranceLu) {
    issues.push(
      issue(
        "loudness_off_target",
        `packaged audio measures ${measured.integratedLufs.toFixed(1)} LUFS; the target is ${rules.targetLufs} +/- ${rules.lufsToleranceLu} LU`,
      ),
    );
  }
  if (measured.truePeakDb > rules.truePeakDbMax) {
    issues.push(
      issue(
        "true_peak_too_high",
        `true peak ${measured.truePeakDb.toFixed(1)} dBFS is above ${rules.truePeakDbMax} dBFS: it will clip on phone speakers`,
      ),
    );
  }
  return issues;
}

/** The same master delivered twice under two episode numbers. */
export function checkDuplicateSource(sha256, alreadySeen) {
  const other = alreadySeen.get(sha256);
  if (!other) return [];
  return [
    issue(
      "duplicate_master",
      `the same file was already delivered as ${other}: one episode would be shown twice`,
    ),
  ];
}

/** One readable block per refused episode. */
export function formatIssues(label, issues) {
  if (issues.length === 0) return "";
  const lines = issues.map((entry) => `    - [${entry.code}] ${entry.message}`);
  return [`  ${label}`, ...lines].join("\n");
}
