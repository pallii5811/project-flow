/**
 * What ingest decides about a delivery before and around the encoder, as pure
 * functions (CP-1, F8). Tested in test/content-pipeline.test.ts.
 *
 *   - slugs become folder names that ingest writes and deletes, so a slug is
 *     checked against the same shape the site uses before it touches a path;
 *   - the episode list must be 1..N with no gap or repeat;
 *   - rights the site cannot honour are refused, not recorded and ignored;
 *   - an episode already packaged is reused only when EVERYTHING the gate
 *     judged it with is unchanged: the master, the rules, and the options the
 *     delivery set (which audio stream, which length range, which resolution).
 */
import { isAbsolute, relative, resolve } from "node:path";

import { isLicensedLanguage } from "./vtt.mjs";

/** The shape of a series or episode slug: it is a URL segment and a folder name. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isSlug(value) {
  return typeof value === "string" && SLUG_PATTERN.test(value);
}

/** `child` resolves strictly inside `parent`: never the parent itself, never above it. */
export function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

function issue(code, message) {
  return { code, message };
}

/** Episode numbers must be 1..N with no gap: a gap breaks auto-continue. */
export function checkEpisodeNumbers(episodes) {
  const issues = [];
  const seen = new Set();
  for (const episode of episodes) {
    const number = episode?.episodeNumber;
    if (!Number.isInteger(number) || number < 1) {
      issues.push(issue("bad_episode_number", `"${String(number)}" is not an episode number`));
      continue;
    }
    if (seen.has(number)) {
      issues.push(issue("duplicate_episode_number", `episode ${number} is delivered twice`));
    }
    seen.add(number);
  }
  const sorted = [...seen].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i] !== i + 1) {
      issues.push(
        issue(
          "episode_gap",
          `episodes jump from ${sorted[i - 1] ?? 0} to ${sorted[i]}: the feed would stop there`,
        ),
      );
      break;
    }
  }
  return issues;
}

/** The folder and URL segment of an episode: `episode-N` unless the delivery names one. */
export function episodeSlugOf(episode) {
  return episode?.episodeSlug ?? `episode-${String(episode?.episodeNumber)}`;
}

/**
 * Every episode slug is a safe, unique folder name. "..", "a/b" or two
 * episodes sharing a slug would make ingest write — and delete — the wrong
 * folder.
 */
export function checkEpisodeSlugs(episodes) {
  const issues = [];
  const seen = new Map();
  for (const episode of episodes) {
    const slug = episodeSlugOf(episode);
    const label = `episode ${String(episode?.episodeNumber)}`;
    if (!isSlug(slug)) {
      issues.push(
        issue(
          "bad_episode_slug",
          `${label}: episodeSlug "${String(slug)}" must be lowercase letters and digits joined by single hyphens`,
        ),
      );
      continue;
    }
    const other = seen.get(slug);
    if (other !== undefined) {
      issues.push(
        issue("duplicate_episode_slug", `${label} and ${other} both use the slug "${slug}"`),
      );
    }
    seen.set(slug, label);
  }
  return issues;
}

/**
 * Rights the site can honour today (F8). The export is one set of files served
 * everywhere: there is no geo-restriction, so a title licensed for part of the
 * world cannot be listed without breaking its licence. Refused, until the
 * serving side can restrict by country.
 */
export function checkRights(delivery) {
  const problems = [];
  const rights = delivery?.rights ?? {};
  const territories = rights.territories;
  if (
    Array.isArray(territories) &&
    territories.length > 0 &&
    !(territories.length === 1 && territories[0] === "WORLD")
  ) {
    problems.push(
      `rights.territories is ${JSON.stringify(territories)}: the site is served worldwide and cannot restrict by country yet, so only ["WORLD"] can be published (docs/content-operations.md §6)`,
    );
  }
  const languages = rights.languages;
  if (Array.isArray(languages) && languages.length > 0) {
    if (typeof delivery.defaultLocale === "string" && !isLicensedLanguage(delivery.defaultLocale, languages)) {
      problems.push(
        `defaultLocale "${delivery.defaultLocale}" (the language the episodes are spoken in) is not in rights.languages ${JSON.stringify(languages)}`,
      );
    }
  }
  return problems;
}

/** A caption track in a language the licence does not cover. */
export function checkCaptionLicence(language, rights) {
  if (isLicensedLanguage(language, rights?.languages)) return [];
  return [
    issue(
      "caption_language_not_licensed",
      `"${String(language)}" is not in rights.languages ${JSON.stringify(rights?.languages ?? [])}: the licence does not cover it`,
    ),
  ];
}

/**
 * The options the gate judges an episode with, as the delivery sets them.
 * Recorded in the packaged episode, so a corrected delivery re-runs the gate.
 */
export function gateOptionsFor(delivery, episode) {
  const range = delivery?.episodeDurationMs ?? {};
  return {
    allowBelow1080p: delivery?.allowBelow1080p === true,
    audioStream: Number.isInteger(episode?.audioStream) ? episode.audioStream : null,
    durationMinMs: Number.isFinite(range.min) ? range.min : null,
    durationMaxMs: Number.isFinite(range.max) ? range.max : null,
  };
}

/** Those options as scripts/package-episode.mjs flags. */
export function packageFlags(options) {
  const flags = [];
  if (options.allowBelow1080p) flags.push("--allow-below-1080p");
  if (options.durationMinMs !== null) flags.push("--duration-min-ms", String(options.durationMinMs));
  if (options.durationMaxMs !== null) flags.push("--duration-max-ms", String(options.durationMaxMs));
  if (options.audioStream !== null) flags.push("--audio-stream", String(options.audioStream));
  return flags;
}

function sameOptions(a, b) {
  if (typeof a !== "object" || a === null) return false;
  return ["allowBelow1080p", "audioStream", "durationMinMs", "durationMaxMs"].every(
    (key) => a[key] === b[key],
  );
}

/**
 * May a packaged episode be reused instead of re-encoded? Only when its record
 * names the same master, the same gate version and the same options. A record
 * written before options were recorded is not current: it was judged by rules
 * nobody can read back.
 */
export function isPackageCurrent(record, expected) {
  if (typeof record !== "object" || record === null) return false;
  return (
    record.sourceSha256 === expected.sourceSha256 &&
    record.gateVersion === expected.gateVersion &&
    sameOptions(record.gateOptions, expected.gateOptions)
  );
}
