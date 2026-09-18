/**
 * Subtitles, verified instead of declared (CP-3).
 *
 * Most of the feed is watched muted, so the captions carry the story. A file
 * that is missing, belongs to another episode, or was shifted by a studio's
 * frame-rate conversion shows no text or the wrong text — and the catalog
 * would still say "ready". Nothing here trusts a file name: the file is
 * parsed, and its cues are compared with the MEASURED duration of the episode.
 *
 * Pure functions, unit-tested in test/content-pipeline.test.ts.
 */

export const CAPTION_RULES = {
  /** Dialogue that starts later than this in an episode that has audio. */
  leadInMaxSeconds: 10,
  /** How far past the end of the episode the last cue may reach. */
  overrunToleranceSeconds: 1,
  /** The last cue must land at least this far into the episode. */
  tailMinFraction: 0.5,
  /** Total cue time against episode length: below this the file is nearly empty. */
  coverageMinFraction: 0.3,
  /** A single cue longer than this is a conversion error, not a line. */
  maxCueSeconds: 15,
};

function issue(code, message) {
  return { code, message };
}

/** "00:01:02.500", "01:02.500" and the comma form used by SRT. */
export function parseTimestamp(raw) {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(raw.trim());
  if (!match) return null;
  const hours = match[1] === undefined ? 0 : Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4].padEnd(3, "0"));
  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Cues and structural errors. Errors are returned, never thrown: a broken
 * file must produce a message naming the episode, not a stack trace.
 */
export function parseVttCues(raw) {
  const errors = [];
  const cues = [];
  const text = stripBom(String(raw)).replace(/\r\n?/g, "\n");
  if (!/^WEBVTT(\s|$)/.test(text)) {
    errors.push(issue("not_webvtt", "the file does not start with WEBVTT"));
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes("-->")) continue;
    const [rawStart, rest] = line.split("-->");
    if (rest === undefined) continue;
    const rawEnd = rest.trim().split(/\s+/)[0] ?? "";
    const startMs = parseTimestamp(rawStart ?? "");
    const endMs = parseTimestamp(rawEnd);
    if (startMs === null || endMs === null) {
      errors.push(issue("unreadable_timing", `line ${i + 1}: cannot read "${line.trim()}"`));
      continue;
    }
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (next.trim() === "" || next.includes("-->")) break;
      body.push(next.trim());
    }
    cues.push({ startMs, endMs, text: body.join(" ").trim() });
  }
  return { cues, errors };
}

/** SRT as studios deliver it → WebVTT. Nothing else is changed. */
export function srtToVtt(raw) {
  const body = stripBom(String(raw))
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*\d+\s*$/gm, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

/**
 * Does this file fit this episode? `durationMs` is the measured duration of
 * the packaged episode, never a declared one.
 */
export function checkCaptionTrack(parsed, options) {
  const rules = { ...CAPTION_RULES, ...(options.rules ?? {}) };
  const { durationMs, language, hasAudio = true } = options;
  const issues = [...parsed.errors];
  const cues = parsed.cues;

  if (!language || !/^[a-z]{2}(-[A-Za-z0-9]+)*$/.test(language)) {
    issues.push(issue("missing_language", `"${String(language)}" is not a language tag`));
  }
  if (cues.length === 0) {
    issues.push(issue("no_cues", "the file parses but has no cues"));
    return issues;
  }

  let covered = 0;
  let previousStart = -1;
  for (const cue of cues) {
    if (cue.endMs <= cue.startMs) {
      issues.push(
        issue("cue_ends_before_it_starts", `cue at ${(cue.startMs / 1000).toFixed(3)} s ends before it starts`),
      );
      continue;
    }
    if (cue.startMs < previousStart) {
      issues.push(
        issue("cues_out_of_order", `cue at ${(cue.startMs / 1000).toFixed(3)} s comes after a later one`),
      );
    }
    previousStart = cue.startMs;
    const seconds = (cue.endMs - cue.startMs) / 1000;
    if (seconds > rules.maxCueSeconds) {
      issues.push(
        issue(
          "cue_too_long",
          `a cue lasts ${seconds.toFixed(1)} s (more than ${rules.maxCueSeconds} s): the file is probably not for this episode`,
        ),
      );
    }
    if (cue.text.length === 0) {
      issues.push(issue("empty_cue", `the cue at ${(cue.startMs / 1000).toFixed(3)} s has no text`));
    }
    covered += cue.endMs - cue.startMs;
  }

  const first = cues[0];
  const last = cues.reduce((latest, cue) => (cue.endMs > latest.endMs ? cue : latest), cues[0]);

  if (hasAudio && first.startMs > rules.leadInMaxSeconds * 1000) {
    issues.push(
      issue(
        "starts_too_late",
        `the first cue starts at ${(first.startMs / 1000).toFixed(1)} s, more than ${rules.leadInMaxSeconds} s in`,
      ),
    );
  }
  if (last.endMs > durationMs + rules.overrunToleranceSeconds * 1000) {
    issues.push(
      issue(
        "drifts_past_the_end",
        `the last cue ends at ${(last.endMs / 1000).toFixed(1)} s, past the ${(durationMs / 1000).toFixed(1)} s episode (tolerance ${rules.overrunToleranceSeconds} s)`,
      ),
    );
  }
  if (last.endMs < durationMs * rules.tailMinFraction) {
    issues.push(
      issue(
        "stops_too_early",
        `the last cue ends at ${(last.endMs / 1000).toFixed(1)} s of a ${(durationMs / 1000).toFixed(1)} s episode: the end has no subtitles`,
      ),
    );
  }
  const coverage = durationMs > 0 ? covered / durationMs : 0;
  if (coverage < rules.coverageMinFraction) {
    issues.push(
      issue(
        "too_little_dialogue",
        `cues cover ${(coverage * 100).toFixed(0)}% of the episode, below ${(rules.coverageMinFraction * 100).toFixed(0)}%`,
      ),
    );
  }

  return issues;
}

/** What the manifest records about a verified track. */
export function captionSummary(parsed, durationMs) {
  const cues = parsed.cues;
  if (cues.length === 0) return { cues: 0, firstCueMs: null, lastCueEndMs: null, coverage: 0 };
  const covered = cues.reduce(
    (sum, cue) => sum + Math.max(0, cue.endMs - cue.startMs),
    0,
  );
  const lastCueEndMs = cues.reduce((latest, cue) => Math.max(latest, cue.endMs), 0);
  return {
    cues: cues.length,
    firstCueMs: cues[0].startMs,
    lastCueEndMs,
    coverage: durationMs > 0 ? Number((covered / durationMs).toFixed(3)) : 0,
  };
}
