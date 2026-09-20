/**
 * Where published media lives when it leaves the static export: object keys,
 * public URLs, content types, cache rules and upload order for Cloudflare R2
 * (or any S3-compatible store behind MEDIA_BASE_URL). Pure; tested in
 * test/media-publish.test.ts.
 *
 * One rule carries everything: on the media store EVERY object is named by
 * its content. Renditions sit in their revision folder (hls/episode-N/<hash>/,
 * as in the export); posters, share cards and captions carry the first 12 hex
 * of their own sha256 in their name. So an object, once written, never
 * changes: it is uploaded once, skipped when present, and cached for a year.
 * The only thing that changes is the series manifest, which ships inside the
 * site build and switches the whole series to its new files in one deploy —
 * a recut never shows new subtitles over old video.
 */
import { IMMUTABLE, originOf } from "./platform.mjs";

/** The variables that switch ingest from "media in the export" to "media on R2". */
export const MEDIA_ENV = ["MEDIA_BASE_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Reads the media configuration from the environment. Never returns or
 * prints a secret's value, only which names are missing.
 *
 * @returns {{ mode: "export" } | { mode: "r2", config: object } | { mode: "error", problems: string[] }}
 */
export function mediaConfig(env) {
  const set = (name) => typeof env[name] === "string" && env[name].trim().length > 0;
  const endpointOverride = set("R2_ENDPOINT");
  const required = MEDIA_ENV.filter((name) => !(name === "R2_ACCOUNT_ID" && endpointOverride));
  const present = required.filter(set);
  if (present.length === 0 && !endpointOverride) return { mode: "export" };
  const problems = [];
  const missing = required.filter((name) => !set(name));
  if (missing.length > 0) {
    problems.push(
      `media on R2 needs ${missing.join(", ")} as well (only ${present.join(", ") || "R2_ENDPOINT"} is set). ` +
        "Set all of them, or none to keep media inside the export",
    );
  }
  const base = set("MEDIA_BASE_URL") ? mediaBaseProblems(env.MEDIA_BASE_URL) : [];
  problems.push(...base);
  let endpoint = null;
  if (endpointOverride) {
    endpoint = env.R2_ENDPOINT.trim().replace(/\/$/, "");
    const url = safeUrl(endpoint);
    if (!url || !(url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)))) {
      problems.push("R2_ENDPOINT must be an https URL (http only for this machine, in tests)");
    }
  } else if (set("R2_ACCOUNT_ID")) {
    const account = env.R2_ACCOUNT_ID.trim();
    if (!/^[0-9a-f]{32}$/i.test(account)) problems.push("R2_ACCOUNT_ID must be the 32-character account ID from the Cloudflare dashboard");
    endpoint = `https://${account}.r2.cloudflarestorage.com`;
  }
  if (set("R2_BUCKET") && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET.trim())) {
    problems.push("R2_BUCKET must be a bucket name: lowercase letters, digits and hyphens");
  }
  if (problems.length > 0) return { mode: "error", problems };
  return {
    mode: "r2",
    config: {
      baseUrl: env.MEDIA_BASE_URL.trim().replace(/\/+$/, ""),
      endpoint,
      bucket: env.R2_BUCKET.trim(),
      accessKeyId: env.R2_ACCESS_KEY_ID.trim(),
      secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim(),
    },
  };
}

function safeUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** MEDIA_BASE_URL: https (http only on this machine), no query, no fragment. */
export function mediaBaseProblems(raw) {
  const url = safeUrl(String(raw ?? "").trim());
  if (!url) return [`MEDIA_BASE_URL is not a URL: "${String(raw)}"`];
  const problems = [];
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    problems.push(`MEDIA_BASE_URL must use https: "${raw}"`);
  }
  if (url.search || url.hash) problems.push(`MEDIA_BASE_URL must not carry a query or a fragment: "${raw}"`);
  return problems;
}

function encodeKey(key) {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * The object key of a file published at `rel` (for example
 * "content/series/x/hls/episode-1/ab12cd34ef56/v0/seg_001.m4s"). A base URL
 * with a path ("https://media.example/v1") puts that path in front of the key,
 * because a custom domain serves the bucket from its root.
 */
export function objectKey(baseUrl, rel) {
  const url = safeUrl(baseUrl);
  const prefix = url ? url.pathname.replace(/^\/+|\/+$/g, "") : "";
  const clean = String(rel).replace(/^\/+/, "");
  return prefix ? `${prefix}/${clean}` : clean;
}

/** The public URL of an object key. */
export function mediaUrl(baseUrl, key) {
  const origin = originOf(baseUrl);
  if (!origin) throw new Error(`not a media base URL: ${String(baseUrl)}`);
  return `${origin}/${encodeKey(key)}`;
}

/** "episode-1.webp" + sha → "episode-1.1a2b3c4d5e6f.webp"; "episode-1.en.vtt" → "episode-1.en.1a2b3c4d5e6f.vtt". */
export function hashedName(name, sha256) {
  if (!/^[0-9a-f]{12,}$/.test(String(sha256))) throw new Error(`not a sha256: ${String(sha256)}`);
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const extension = dot <= 0 ? "" : name.slice(dot);
  return `${stem}.${sha256.slice(0, 12)}${extension}`;
}

const TYPES = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".vtt": "text/vtt; charset=utf-8",
};

/** Content-Type for a published file; null for anything that must not be published. */
export function contentTypeOf(name) {
  const dot = String(name).lastIndexOf(".");
  return dot === -1 ? null : (TYPES[name.slice(dot).toLowerCase()] ?? null);
}

/**
 * Every object on the media store is named by its content (see above), so
 * every one — segments, playlists, posters, captions — is cached for a year.
 * The pointer that changes is the manifest in the site build, cached a minute.
 */
export function cacheControlOf() {
  return IMMUTABLE;
}

/**
 * The order an encode is uploaded in, as phases: media first, then the
 * rendition playlists, then master.m3u8 alone. A master playlist present on
 * the store therefore proves the whole folder is there: an upload that dies
 * halfway leaves no playlist naming a missing segment, and a later run knows
 * a folder is complete from one HEAD.
 *
 * @param {string[]} files  paths relative to the revision folder
 * @returns {string[][]}
 */
export function uploadPhases(files) {
  const media = [];
  const playlists = [];
  const master = [];
  for (const file of files) {
    if (file === "master.m3u8") master.push(file);
    else if (file.endsWith(".m3u8")) playlists.push(file);
    else media.push(file);
  }
  return [media.sort(), playlists.sort(), master].filter((phase) => phase.length > 0);
}

/**
 * The runner minutes a run used and what they buy: GitHub bills a job by the
 * started minute; a private repository gets 2,000 free minutes a month on
 * standard Linux runners (docs/cloud-ingest.md).
 */
export function minutesReport({ startedAtMs, endedAtMs, videoSeconds, freeMinutes = 2000 }) {
  const minutes = Math.max(1, Math.ceil((endedAtMs - startedAtMs) / 60_000));
  const perVideoMinute = videoSeconds > 0 ? minutes / (videoSeconds / 60) : null;
  return {
    minutes,
    videoMinutes: videoSeconds / 60,
    perVideoMinute,
    runsPerMonth: Math.floor(freeMinutes / minutes),
    videoMinutesPerMonth: perVideoMinute ? freeMinutes / perVideoMinute : null,
  };
}
