/**
 * A small client for Cloudflare R2's S3-compatible API: HEAD and PUT, signed
 * with scripts/lib/sigv4.mjs. No SDK: two verbs do not justify a dependency.
 *
 *   endpoint  https://<account id>.r2.cloudflarestorage.com (R2_ENDPOINT in tests)
 *   region    "auto", service "s3", path-style: <endpoint>/<bucket>/<key>
 *
 * Every PUT carries the sha256 of its body in x-amz-content-sha256, which the
 * store checks, so an object is either whole or absent. A failure the store
 * causes (timeout, 408, 425, 429, 5xx, a dropped connection) is retried with
 * a growing wait; a refusal (400, 401, 403, …) stops at once with the
 * store's own words — retrying a wrong key does not make it right.
 */
import { Buffer } from "node:buffer";
import { setTimeout as sleep } from "node:timers/promises";

import { cacheControlOf, contentTypeOf, uploadPhases } from "./media-publish.mjs";
import { amzDate, sha256Hex, signRequest } from "./sigv4.mjs";

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class MediaStoreError extends Error {
  constructor(message, { status = null, transient = false } = {}) {
    super(message);
    this.name = "MediaStoreError";
    this.status = status;
    this.transient = transient;
  }
}

function encodeKey(key) {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

/**
 * @param {{ endpoint: string, bucket: string, accessKeyId: string, secretAccessKey: string }} config
 * @param {{ fetchImpl?: typeof fetch, now?: () => Date, retries?: number, backoffMs?: number, timeoutMs?: number }} [options]
 */
export function createMediaStore(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const retries = options.retries ?? 3;
  const backoffMs = options.backoffMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const endpoint = new URL(config.endpoint);
  const stats = { head: 0, put: 0, putBytes: 0, retried: 0 };

  async function send(method, key, { body = null, headers = [] } = {}) {
    const path = `/${config.bucket}/${encodeKey(key)}`;
    const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) {
        stats.retried += 1;
        await sleep(backoffMs * 3 ** (attempt - 1));
      }
      const datetime = amzDate(now());
      const signedHeaders = [
        ["host", endpoint.host],
        ["x-amz-content-sha256", payloadHash],
        ["x-amz-date", datetime],
        ...headers,
      ];
      const signed = signRequest({
        method,
        path,
        headers: signedHeaders,
        payloadHash,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        region: "auto",
        service: "s3",
        datetime,
        s3: true,
      });
      let response;
      try {
        response = await fetchImpl(`${endpoint.origin}${path}`, {
          method,
          headers: Object.fromEntries([
            ...signedHeaders.filter(([name]) => name !== "host"),
            ["authorization", signed.authorization],
          ]),
          body: body ?? undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastError = new MediaStoreError(`${method} ${key}: ${error.message}`, { transient: true });
        continue;
      }
      if (response.ok || (method === "HEAD" && response.status === 404)) return response;
      const text = method === "HEAD" ? "" : (await response.text().catch(() => "")).slice(0, 300);
      const transient = TRANSIENT_STATUS.has(response.status);
      // A HEAD answer has no body: say what the status means for the person reading the log.
      const hint =
        response.status === 401 || response.status === 403
          ? " (the R2 token in the secrets is wrong, expired, or not allowed to write this bucket)"
          : "";
      lastError = new MediaStoreError(
        `${method} ${key}: the media store answered ${response.status}${hint}${text ? ` — ${text}` : ""}`,
        { status: response.status, transient },
      );
      if (!transient) throw lastError;
    }
    throw lastError;
  }

  return {
    stats,
    /** { exists, etag, bytes } — never throws on a plain "not there". */
    async head(key) {
      stats.head += 1;
      const response = await send("HEAD", key);
      if (response.status === 404) return { exists: false, etag: null, bytes: null };
      return {
        exists: true,
        etag: response.headers.get("etag"),
        bytes: Number(response.headers.get("content-length")),
      };
    },
    async put(key, body, { contentType, cacheControl }) {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      await send("PUT", key, {
        body: bytes,
        headers: [
          ["content-type", contentType],
          ["cache-control", cacheControl],
        ],
      });
      stats.put += 1;
      stats.putBytes += bytes.length;
    },
  };
}

/**
 * Uploads one object unless it is already there. Keys are named by their
 * content (scripts/lib/media-publish.mjs), so "there" means "identical".
 */
export async function publishObject(store, key, readBody) {
  if ((await store.head(key)).exists) return { uploaded: 0, skipped: 1, bytes: 0 };
  const body = await readBody();
  await store.put(key, body, { contentType: contentTypeOrThrow(key), cacheControl: cacheControlOf(key) });
  return { uploaded: 1, skipped: 0, bytes: body.length };
}

function contentTypeOrThrow(key) {
  const type = contentTypeOf(key);
  if (!type) throw new MediaStoreError(`${key}: not a file type the site publishes`);
  return type;
}

/**
 * Uploads an encode (a revision folder) in the phases of uploadPhases: media,
 * then rendition playlists, then master.m3u8. When master.m3u8 is already on
 * the store the whole folder is, and nothing else is even asked for.
 *
 * @param {{ keyPrefix: string, files: string[], read: (rel: string) => Promise<Buffer>|Buffer, concurrency?: number }} folder
 */
export async function publishFolder(store, { keyPrefix, files, read, concurrency = 8 }) {
  const total = { uploaded: 0, skipped: 0, bytes: 0 };
  if (files.includes("master.m3u8") && (await store.head(`${keyPrefix}/master.m3u8`)).exists) {
    total.skipped = files.length;
    return total;
  }
  for (const phase of uploadPhases(files)) {
    await inPool(phase, concurrency, async (rel) => {
      const done = await publishObject(store, `${keyPrefix}/${rel}`, async () => read(rel));
      total.uploaded += done.uploaded;
      total.skipped += done.skipped;
      total.bytes += done.bytes;
    });
  }
  return total;
}

/** Runs `work` over `items`, at most `limit` at a time; the first failure stops new work and is thrown. */
export async function inPool(items, limit, work) {
  let next = 0;
  let failure = null;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (failure === null && next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await work(item);
      } catch (error) {
        failure ??= error;
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
}
