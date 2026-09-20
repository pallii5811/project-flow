/**
 * Where one long delivery breaks into episodes, as pure functions.
 *
 * Some studios deliver a whole vertical mini-series as ONE file: dozens of
 * one-to-three-minute episodes glued together. scripts/split-compilation.mjs
 * runs ffmpeg over it once and hands the text it prints to these functions,
 * which propose where each episode starts, say why, and say how sure they
 * are. A person (or Claude) checks every cut on a contact sheet before
 * anything is split; nothing here publishes anything.
 *
 * What ffmpeg can measure, and what each thing is worth:
 *
 *   - black picture (blackdetect): compilations put a few black frames, or a
 *     fade to black, between episodes. Strong, and exact to the frame: the
 *     next episode starts on the first frame that is not black.
 *   - silence (silencedetect): a pause in the sound that lines up with a
 *     picture cut. Strong when it is long, but it only says "around here":
 *     the frame comes from the picture cut inside it.
 *   - a picture cut (scdet): exact to the frame, and WEAK on its own. Real
 *     drama cuts between shots every few seconds, and a hard cut between two
 *     episodes looks exactly like a shot change. A cut proposed on this
 *     alone is always marked low confidence.
 *   - a fade (the average brightness, signalstats YAVG): tells a fade to
 *     black from a cut to black. It describes black; it is not a cut alone.
 *   - the length of an episode: the delivery says how many episodes there
 *     are and how long one may be (series.json), so the cuts are chosen
 *     together, as the set that best explains the file with episodes of a
 *     regular length. A cut nothing visible supports is still placed where
 *     the lengths need it, and marked "none": a person must find it.
 *
 * Every function returns data; the caller prints and writes. Tested in
 * test/split-rules.test.ts, proven on a real compilation by
 * scripts/split-proof.mjs.
 */
import { createHash } from "node:crypto";

/** Bumped when the way a compilation is cut changes: a split episode gets a new identity. */
export const SPLIT_VERSION = 1;

export const SPLIT_RULES = {
  /** scdet score (0–100) from which a frame counts as a picture cut. */
  sceneThreshold: 8,
  /** Black this long is enough to be a gap (one frame at 25 fps). */
  blackMinSeconds: 0.04,
  /** Silence at this level and this long is a pause in the sound. */
  silenceNoiseDb: -45,
  silenceMinSeconds: 0.3,
  /** A silence counts for a picture cut this close to it. */
  silenceReachSeconds: 0.25,
  /** Evidence this close together is one candidate. */
  mergeSeconds: 0.3,
  /** Where nothing is visible, a blind position is offered every this many seconds. */
  blindStepSeconds: 1,
  /** A rival this close to a chosen cut, and nearly as strong, makes it ambiguous. */
  rivalSeconds: 5,
  /** Weight of the regular-length prior against the evidence (score points per 100% off). */
  lengthWeight: 1,
  /** Without a known episode count, a cut must earn this much to be proposed. */
  cutCost: 2,
};

const SCORE = {
  blackLong: 4, // 0.2 s or more of black
  black: 3,
  fade: 1, // on top of black: a fade to black is a deliberate ending
  silenceLong: 3, // 0.5 s or more of silence around a picture cut
  silence: 2,
  scene: 1,
  silenceOnly: 1, // a pause with no picture cut inside it: where, is a guess
};

function issue(code, message) {
  return { code, message };
}

/** "25/1", "30000/1001" or a number → frames per second, or null. */
export function parseFrameRate(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const [num, den] = String(raw ?? "").split("/").map(Number);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (den === undefined) return num;
  return Number.isFinite(den) && den > 0 ? num / den : null;
}

/** Seconds → "HH:MM:SS.mmm", the form a person reads on a contact sheet. */
export function timecode(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

/** "HH:MM:SS.mmm" or "MM:SS.mmm" → seconds, or null. */
export function parseTimecode(raw) {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)$/.exec(String(raw ?? "").trim());
  if (!match) return null;
  const hours = match[1] === undefined ? 0 : Number(match[1]);
  return hours * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** The frame a time falls on: frames are numbered from 0 at the start of the file. */
export function frameAt(seconds, fps) {
  return Math.round(seconds * fps);
}

/** `[scdet @ …] lavfi.scd.score: 13.776, lavfi.scd.time: 10.04` → [{ time, score }]. */
export function parseSceneChanges(text) {
  const out = [];
  for (const match of String(text).matchAll(
    /lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*(-?[\d.]+)/g,
  )) {
    out.push({ score: Number(match[1]), time: Number(match[2]) });
  }
  return out;
}

/**
 * The file written by `signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG`:
 * `frame:N pts:… pts_time:T` then `lavfi.signalstats.YAVG=V` → [{ time, yavg }].
 */
export function parseLumaSeries(text) {
  const out = [];
  let time = null;
  for (const line of String(text).split(/\r?\n/)) {
    const frame = /pts_time:\s*(-?[\d.]+)/.exec(line);
    if (frame) {
      time = Number(frame[1]);
      continue;
    }
    const value = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    if (value && time !== null) {
      out.push({ time, yavg: Number(value[1]) });
      time = null;
    }
  }
  return out;
}

/**
 * cropdetect lines → the crop it settled on most often, with how often, or
 * null when it printed nothing. Sampled once a second by the caller.
 */
export function parseCropDetect(text) {
  const counts = new Map();
  let total = 0;
  for (const match of String(text).matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)) {
    const key = `${match[1]}:${match[2]}:${match[3]}:${match[4]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return null;
  let best = null;
  for (const [key, count] of counts) if (!best || count > best.count) best = { key, count };
  const [w, h, x, y] = best.key.split(":").map(Number);
  return { w, h, x, y, share: best.count / total, samples: total };
}

/**
 * A horizontal file with a vertical picture in the middle and black bars on
 * both sides (pillarbox): the studio exported the vertical cut into a 16:9
 * frame. Reported, never fixed silently: cropping it back gives a picture
 * about a third as tall as a real vertical master.
 *
 * `crop` is cropdetect's verdict in the file's own pixels.
 */
export function pillarboxVerdict(crop, width, height, rules = { aspectMin: 0.45, aspectMax: 0.65 }) {
  if (!crop || !(width > 0) || !(height > 0)) return { pillarboxed: false };
  const landscape = width > height;
  const aspect = crop.w / crop.h;
  const narrow = crop.w <= width * 0.75;
  const fullHeight = crop.h >= height * 0.9;
  const settled = crop.share >= 0.6;
  if (!landscape || !narrow || !fullHeight || !settled) return { pillarboxed: false, aspect };
  if (aspect < rules.aspectMin || aspect > rules.aspectMax) return { pillarboxed: false, aspect };
  return {
    pillarboxed: true,
    aspect,
    crop: { w: crop.w, h: crop.h, x: crop.x, y: crop.y },
    message:
      `a horizontal ${width}x${height} file with a vertical ${crop.w}x${crop.h} picture in the middle ` +
      `(black bars left and right). Ask the studio for the vertical master. Cropping is possible, ` +
      `but gives a ${crop.w}x${crop.h} episode: lower quality than a 1080x1920 master`,
  };
}

/**
 * Did the picture fade into this black, instead of cutting to it? The
 * brightness over the half second before must fall steadily, to less than
 * half of where it started.
 */
export function fadedInto(luma, blackStart) {
  if (!Array.isArray(luma) || luma.length === 0) return false;
  const window = luma.filter((sample) => sample.time >= blackStart - 0.6 && sample.time < blackStart);
  if (window.length < 4) return false;
  const first = window[0].yavg;
  const last = window[window.length - 1].yavg;
  if (!(first > 0) || last > first / 2) return false;
  let rises = 0;
  for (let i = 1; i < window.length; i += 1) if (window[i].yavg > window[i - 1].yavg + 1) rises += 1;
  return rises <= Math.floor(window.length / 5);
}

/**
 * Every place an episode could start, with the evidence for it.
 *
 * @param {object} input
 * @param {number} input.fps
 * @param {number} input.durationSeconds
 * @param {{start:number,end:number,duration:number}[]} input.black
 * @param {{start:number,end:number|null,duration:number|null}[]} input.silence
 * @param {{time:number,score:number}[]} input.scenes
 * @param {{time:number,yavg:number}[]} [input.luma]
 */
export function buildCandidates(input, rules = SPLIT_RULES) {
  const { fps, durationSeconds } = input;
  const lastFrame = Math.round(durationSeconds * fps);
  /** frame → candidate */
  const byFrame = new Map();
  const add = (frame, evidence) => {
    if (frame <= 0 || frame >= lastFrame) return;
    // Evidence a few frames apart describes one transition.
    const reach = Math.max(1, Math.round(rules.mergeSeconds * fps));
    let target = null;
    for (const [other, candidate] of byFrame) {
      if (Math.abs(other - frame) <= reach) {
        target = candidate;
        break;
      }
    }
    if (!target) {
      target = { frame, evidence: [] };
      byFrame.set(frame, target);
    }
    target.evidence.push(evidence);
    // The exact frame comes from the most exact evidence: end of black, then a picture cut.
    const precise = target.evidence.find((entry) => entry.kind === "black") ??
      target.evidence.find((entry) => entry.kind === "scene");
    if (precise && precise.frame !== target.frame) {
      byFrame.delete(target.frame);
      target.frame = precise.frame;
      byFrame.set(target.frame, target);
    }
  };

  for (const range of input.black ?? []) {
    if (!(range.duration >= rules.blackMinSeconds)) continue;
    const frame = frameAt(range.end, fps);
    add(frame, {
      kind: "black",
      frame,
      from: range.start,
      to: range.end,
      seconds: range.duration,
      fade: fadedInto(input.luma ?? [], range.start),
    });
  }
  for (const change of input.scenes ?? []) {
    if (!(change.score >= rules.sceneThreshold)) continue;
    const frame = frameAt(change.time, fps);
    add(frame, { kind: "scene", frame, score: change.score });
  }

  const candidates = [...byFrame.values()];
  for (const range of input.silence ?? []) {
    const start = range.start;
    const end = range.end ?? durationSeconds;
    const seconds = range.duration ?? end - start;
    if (!(seconds >= rules.silenceMinSeconds)) continue;
    const inside = candidates.filter((candidate) => {
      const time = candidate.frame / fps;
      return time >= start - rules.silenceReachSeconds && time <= end + rules.silenceReachSeconds;
    });
    const evidence = { kind: "silence", from: start, to: end, seconds };
    if (inside.length > 0) {
      for (const candidate of inside) candidate.evidence.push(evidence);
    } else {
      // Sound stops and nothing in the picture says where: the frame is a guess.
      const frame = frameAt(end, fps);
      if (frame > 0 && frame < lastFrame) {
        const candidate = { frame, evidence: [{ ...evidence, alone: true }] };
        candidates.push(candidate);
      }
    }
  }

  return candidates
    .map((candidate) => ({ ...candidate, time: candidate.frame / fps, score: scoreOf(candidate.evidence) }))
    .sort((a, b) => a.frame - b.frame);
}

/** How much a set of evidence is worth. */
export function scoreOf(evidence) {
  let score = 0;
  const black = evidence.find((entry) => entry.kind === "black");
  const silence = evidence.filter((entry) => entry.kind === "silence");
  const scene = evidence.some((entry) => entry.kind === "scene");
  if (black) {
    score += black.seconds >= 0.2 ? SCORE.blackLong : SCORE.black;
    if (black.fade) score += SCORE.fade;
  } else if (scene) {
    score += SCORE.scene;
  }
  const longest = silence.reduce((max, entry) => Math.max(max, entry.seconds), 0);
  if (silence.some((entry) => entry.alone)) score += SCORE.silenceOnly;
  else if (longest >= 0.5) score += SCORE.silenceLong;
  else if (longest > 0) score += SCORE.silence;
  return score;
}

/** One sentence a person can check against the contact sheet. */
export function describeEvidence(evidence) {
  if (evidence.length === 0) return "nothing visible or audible: placed by episode length only";
  const parts = [];
  const black = evidence.find((entry) => entry.kind === "black");
  if (black) {
    parts.push(
      `${black.fade ? "fade to black" : "cut to black"}, ${black.seconds.toFixed(2)} s of black ending here`,
    );
  }
  const scene = evidence.find((entry) => entry.kind === "scene");
  if (scene && !black) parts.push(`picture cut (score ${scene.score.toFixed(1)})`);
  const silence = evidence
    .filter((entry) => entry.kind === "silence")
    .sort((a, b) => b.seconds - a.seconds)[0];
  if (silence) {
    parts.push(
      silence.alone
        ? `${silence.seconds.toFixed(2)} s of silence with no picture cut inside it: the exact frame is a guess`
        : `${silence.seconds.toFixed(2)} s of silence`,
    );
  }
  return parts.join(" + ");
}

/**
 * The cuts, chosen together: the set of positions that best explains the file
 * with every episode inside [minSeconds, maxSeconds] and of a regular length.
 *
 * @param {object} input
 * @param {number} input.fps
 * @param {number} input.durationSeconds  from the first frame kept to the last
 * @param {ReturnType<typeof buildCandidates>} input.candidates
 * @param {number|null} input.episodes    how many episodes the delivery lists, or null
 * @param {number} input.minSeconds
 * @param {number} input.maxSeconds
 * @returns {{ ok: true, cuts: object[] } | { ok: false, reason: string }}
 */
export function chooseCuts(input, rules = SPLIT_RULES) {
  const { fps, durationSeconds, episodes, minSeconds, maxSeconds } = input;
  const lastFrame = Math.round(durationSeconds * fps);
  const minFrames = Math.ceil(minSeconds * fps);
  const maxFrames = Math.floor(maxSeconds * fps);
  if (episodes !== null && episodes !== undefined) {
    if (!Number.isInteger(episodes) || episodes < 1) return { ok: false, reason: "the episode count is not a whole number" };
    if (episodes * minFrames > lastFrame) {
      return {
        ok: false,
        reason: `${episodes} episodes of at least ${minSeconds} s need ${(episodes * minSeconds).toFixed(0)} s; the file is ${durationSeconds.toFixed(1)} s`,
      };
    }
    if (episodes * maxFrames < lastFrame) {
      return {
        ok: false,
        reason: `${episodes} episodes of at most ${maxSeconds} s cover ${(episodes * maxSeconds).toFixed(0)} s; the file is ${durationSeconds.toFixed(1)} s`,
      };
    }
  }

  // Evidence, plus blind positions where the lengths may need a cut nothing shows.
  const points = new Map();
  for (const candidate of input.candidates) points.set(candidate.frame, candidate);
  const blindStep = Math.max(1, Math.round(rules.blindStepSeconds * fps));
  for (let frame = blindStep; frame < lastFrame; frame += blindStep) {
    if (!points.has(frame)) points.set(frame, { frame, time: frame / fps, score: 0, evidence: [] });
  }
  const nodes = [
    { frame: 0, score: 0, evidence: [] },
    ...[...points.values()].sort((a, b) => a.frame - b.frame),
    { frame: lastFrame, score: 0, evidence: [] },
  ];
  const typical = episodes ? lastFrame / episodes : (minFrames + maxFrames) / 2;
  const lengthCost = (frames) => (rules.lengthWeight * Math.abs(frames - typical)) / typical;

  const count = nodes.length;
  const maxK = episodes ?? Math.ceil(lastFrame / Math.max(1, minFrames));
  // best[k][i]: best value reaching node i with k segments; from[k][i]: previous node.
  const best = Array.from({ length: maxK + 1 }, () => new Float64Array(count).fill(-Infinity));
  const from = Array.from({ length: maxK + 1 }, () => new Int32Array(count).fill(-1));
  best[0][0] = 0;
  let low = 0;
  for (let i = 1; i < count; i += 1) {
    const frame = nodes[i].frame;
    while (low < i && frame - nodes[low].frame > maxFrames) low += 1;
    const gain = i === count - 1 ? 0 : nodes[i].score - (episodes ? 0 : rules.cutCost);
    for (let j = low; j < i; j += 1) {
      const length = frame - nodes[j].frame;
      if (length < minFrames) break;
      const cost = lengthCost(length);
      for (let k = 1; k <= maxK; k += 1) {
        const previous = best[k - 1][j];
        if (previous === -Infinity) continue;
        const value = previous + gain - cost;
        if (value > best[k][i]) {
          best[k][i] = value;
          from[k][i] = j;
        }
      }
    }
  }
  let segments = null;
  if (episodes) {
    if (best[episodes][count - 1] !== -Infinity) segments = episodes;
  } else {
    let top = -Infinity;
    for (let k = 1; k <= maxK; k += 1) {
      if (best[k][count - 1] > top) {
        top = best[k][count - 1];
        segments = k;
      }
    }
  }
  if (segments === null) {
    return { ok: false, reason: "no set of cuts keeps every episode inside the allowed length" };
  }
  const chosen = [];
  let i = count - 1;
  for (let k = segments; k > 0; k -= 1) {
    const j = from[k][i];
    if (j > 0) chosen.unshift(nodes[j]);
    i = j;
  }

  const rivalFrames = Math.round(rules.rivalSeconds * fps);
  const cuts = chosen.map((node) => {
    const rivals = input.candidates.filter(
      (other) =>
        other.frame !== node.frame &&
        Math.abs(other.frame - node.frame) <= rivalFrames &&
        other.score >= node.score - 1 &&
        other.score > 0,
    );
    // Strong: black of two frames or more, a fade into black, or a long
    // silence around a picture cut. A picture cut alone never is.
    const strong =
      node.evidence.some(
        (entry) => entry.kind === "black" && (entry.seconds >= 2 / fps - 1e-6 || entry.fade),
      ) ||
      (node.evidence.some((entry) => entry.kind === "silence" && !entry.alone && entry.seconds >= 0.5) &&
        node.evidence.some((entry) => entry.kind === "scene" || entry.kind === "black"));
    let confidence;
    if (node.evidence.length === 0) confidence = "none";
    else if (strong && node.score >= 3 && rivals.length === 0) confidence = "high";
    else confidence = "low";
    return {
      frame: node.frame,
      time: node.frame / fps,
      at: timecode(node.frame / fps),
      confidence,
      score: node.score,
      evidence: node.evidence,
      why: describeEvidence(node.evidence),
      rivals: rivals.map((other) => ({ frame: other.frame, at: timecode(other.frame / fps), score: other.score })),
    };
  });
  return { ok: true, cuts };
}

/**
 * The cuts file a person confirms. Frames are the truth; `at` is a label and
 * must agree with its frame, so a half-edited file is caught.
 */
export function buildCutsFile({ slug, source, cuts, episodes, crop, notes, startFrame = 0, endFrame }) {
  const fps = parseFrameRate(source.frameRate);
  const last = endFrame ?? source.frames ?? Math.round((source.durationMs / 1000) * fps);
  return {
    schemaVersion: 1,
    seriesSlug: slug,
    confirmed: false,
    source: {
      file: source.file,
      sha256: source.sha256,
      bytes: source.bytes,
      durationMs: source.durationMs,
      frames: source.frames ?? last,
      frameRate: source.frameRate,
      width: source.width,
      height: source.height,
    },
    startFrame,
    endFrame: last,
    crop: crop ?? null,
    cuts: cuts.map((cut, index) => ({
      between: [index + 1, index + 2],
      frame: cut.frame,
      at: timecode(cut.frame / fps),
      confidence: cut.confidence,
      why: cut.why,
      ...(cut.rivals?.length ? { rivals: cut.rivals.map((rival) => rival.at) } : {}),
      ...(cut.contactSheet ? { contactSheet: cut.contactSheet } : {}),
    })),
    expectedEpisodes: episodes,
    notes: notes ?? [],
    splitVersion: SPLIT_VERSION,
  };
}

/**
 * Checks a cuts file before anything is split: confirmed by a person, for
 * this exact file, with one cut between each pair of the delivery's
 * episodes, and every episode inside the allowed length.
 *
 * @returns {{ issues: {code:string,message:string}[], episodes: {episodeNumber:number,startFrame:number,endFrame:number}[] }}
 */
export function checkCutsFile(file, { episodes, minMs, maxMs, sourceSha256, requireConfirmed = true }) {
  const issues = [];
  if (typeof file !== "object" || file === null) {
    return { issues: [issue("unreadable_cuts", "the cuts file is not a JSON object")], episodes: [] };
  }
  if (file.schemaVersion !== 1) issues.push(issue("cuts_schema", `schemaVersion ${String(file.schemaVersion)}, expected 1`));
  if (requireConfirmed && file.confirmed !== true) {
    issues.push(
      issue(
        "cuts_not_confirmed",
        'nobody confirmed these cuts: check every contact sheet, then set "confirmed": true',
      ),
    );
  }
  const fps = parseFrameRate(file.source?.frameRate);
  if (!fps) issues.push(issue("cuts_frame_rate", `unreadable frame rate "${String(file.source?.frameRate)}"`));
  if (sourceSha256 !== undefined && file.source?.sha256 !== sourceSha256) {
    issues.push(
      issue(
        "cuts_other_file",
        `the cuts were made for ${String(file.source?.sha256).slice(0, 12)}…, the delivered file is ${String(sourceSha256).slice(0, 12)}…: the studio sent another file behind the link`,
      ),
    );
  }
  if (issues.some((entry) => entry.code === "cuts_frame_rate")) return { issues, episodes: [] };

  const totalFrames = Number.isInteger(file.source?.frames)
    ? file.source.frames
    : Math.round(((file.source?.durationMs ?? 0) / 1000) * fps);
  const start = file.startFrame ?? 0;
  const end = file.endFrame ?? totalFrames;
  if (!Number.isInteger(start) || start < 0) issues.push(issue("cuts_bounds", `startFrame ${String(start)} is not a frame`));
  if (!Number.isInteger(end) || end > totalFrames || end <= start) {
    issues.push(issue("cuts_bounds", `endFrame ${String(end)} is outside the file (${totalFrames} frames)`));
  }
  const cuts = Array.isArray(file.cuts) ? file.cuts : [];
  const frames = [];
  cuts.forEach((cut, index) => {
    const frame = cut?.frame;
    if (!Number.isInteger(frame)) {
      issues.push(issue("cuts_frame", `cut ${index + 1}: "frame" must be a whole frame number`));
      return;
    }
    const labelled = parseTimecode(cut.at);
    if (cut.at !== undefined && (labelled === null || Math.abs(labelled * fps - frame) > 0.5 + 1e-6)) {
      issues.push(
        issue(
          "cuts_label",
          `cut ${index + 1}: "at" ${String(cut.at)} is not frame ${frame} (${timecode(frame / fps)}): edit "frame", "at" is only its label`,
        ),
      );
    }
    frames.push(frame);
  });
  for (let i = 0; i < frames.length; i += 1) {
    const previous = i === 0 ? start : frames[i - 1];
    if (frames[i] <= previous) {
      issues.push(issue("cuts_order", `cut ${i + 1} (frame ${frames[i]}) is not after frame ${previous}`));
    }
  }
  if (frames.length > 0 && frames[frames.length - 1] >= end) {
    issues.push(issue("cuts_order", `the last cut (frame ${frames[frames.length - 1]}) is not before endFrame ${end}`));
  }
  if (Number.isInteger(episodes) && frames.length + 1 !== episodes) {
    issues.push(
      issue(
        "cuts_count",
        `${frames.length} cuts make ${frames.length + 1} episodes; series.json lists ${episodes}`,
      ),
    );
  }
  const bounds = [start, ...frames, end];
  const ranges = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const range = { episodeNumber: i + 1, startFrame: bounds[i], endFrame: bounds[i + 1] };
    const ms = ((range.endFrame - range.startFrame) / fps) * 1000;
    if (ms < minMs || ms > maxMs) {
      issues.push(
        issue(
          "cuts_length",
          `episode ${range.episodeNumber} would be ${(ms / 1000).toFixed(2)} s, outside ${(minMs / 1000).toFixed(0)}-${(maxMs / 1000).toFixed(0)} s`,
        ),
      );
    }
    ranges.push(range);
  }
  const crop = file.crop;
  if (crop !== null && crop !== undefined) {
    const valid = ["w", "h", "x", "y"].every((key) => Number.isInteger(crop[key]) && crop[key] >= 0);
    if (!valid || !(crop.w > 0 && crop.h > 0)) issues.push(issue("cuts_crop", "crop must have whole w, h, x, y"));
    if (typeof crop.apply !== "boolean") {
      issues.push(issue("cuts_crop", 'crop.apply must be true (crop, lower quality) or false (do not crop)'));
    }
  }
  return { issues, episodes: ranges };
}

/**
 * Splitting a compilation alters the work, so the licence must say it may
 * be done: `splitAllowed: true`, and where the studio's written OK is.
 */
export function checkSplitPermission(delivery) {
  const permission = delivery?.splitPermission;
  if (delivery?.splitAllowed !== true) {
    return [
      issue(
        "split_not_allowed",
        'series.json does not say the studio allows cutting this file into episodes: set "splitAllowed": true only with their written OK, and record it in "splitPermission"',
      ),
    ];
  }
  const problems = [];
  if (typeof permission !== "object" || permission === null) {
    problems.push(issue("split_permission_missing", 'splitAllowed needs "splitPermission": { "grantedOn", "source" }'));
    return problems;
  }
  if (typeof permission.grantedOn !== "string" || !Number.isFinite(Date.parse(permission.grantedOn))) {
    problems.push(issue("split_permission_date", `splitPermission.grantedOn "${String(permission.grantedOn)}" is not a date`));
  }
  if (typeof permission.source !== "string" || permission.source.trim().length < 8) {
    problems.push(
      issue(
        "split_permission_source",
        "splitPermission.source must say where the written OK is (the email, the contract clause)",
      ),
    );
  }
  return problems;
}

/**
 * The identity of a split episode: which frames of which file, cut how. It
 * does not depend on the bytes of the re-encoded master, so an episode cut
 * again on another machine is recognised as the same episode.
 */
export function splitIdentity({ sourceSha256, startFrame, endFrame, frameRate, crop }) {
  const canonical = JSON.stringify({
    splitVersion: SPLIT_VERSION,
    sourceSha256,
    startFrame,
    endFrame,
    frameRate: String(frameRate),
    crop: crop && crop.apply === true ? { w: crop.w, h: crop.h, x: crop.x, y: crop.y } : null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The disk a split needs, in bytes: the delivered file, the per-episode
 * masters written next to it, and the renditions of the episode being
 * packaged. Checked before starting, so a runner that is too small says so
 * at minute one, not at minute two hundred.
 */
export function splitDiskNeed({ sourceBytes, masterRatio = 1.8 }) {
  return Math.round(sourceBytes * (1 + masterRatio));
}
