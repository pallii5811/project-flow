/**
 * Media on R2: the configuration switch, the names and URLs of objects, and
 * the upload itself against a local stand-in for R2 that checks every
 * signature the way the real store does (scripts/lib/fake-media-store.mjs).
 *
 * The rules that matter are proven to fail too: a wrong secret, a body that
 * does not match its signed hash, a store that refuses — and the one that
 * makes a year of cache safe: master.m3u8 goes up last, so a folder is never
 * named by a playlist before its segments are there.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startFakeMediaStore } from "../scripts/lib/fake-media-store.mjs";
import {
  MEDIA_ENV,
  cacheControlOf,
  contentTypeOf,
  hashedName,
  mediaBaseProblems,
  mediaConfig,
  mediaUrl,
  minutesReport,
  objectKey,
  uploadPhases,
} from "../scripts/lib/media-publish.mjs";
import { IMMUTABLE, headersFile } from "../scripts/lib/platform.mjs";
import { headersFor, parseHeadersFile } from "../scripts/lib/pages-headers.mjs";
import { MediaStoreError, createMediaStore, publishFolder, publishObject } from "../scripts/lib/r2.mjs";

const SECRET = "fake-secret-key-that-must-never-be-printed";
const ACCOUNT = "0123456789abcdef0123456789abcdef";

const fullEnv = {
  MEDIA_BASE_URL: "https://media.cliffies.example",
  R2_ACCOUNT_ID: ACCOUNT,
  R2_ACCESS_KEY_ID: "AKIDFAKE",
  R2_SECRET_ACCESS_KEY: SECRET,
  R2_BUCKET: "cliffies-media",
};

describe("mediaConfig: all or nothing", () => {
  it("no variable: media stays in the export, exactly as before", () => {
    expect(mediaConfig({})).toEqual({ mode: "export" });
    expect(mediaConfig({ OTHER: "x" })).toEqual({ mode: "export" });
  });

  it("every variable: R2, on the account's endpoint", () => {
    const result = mediaConfig(fullEnv);
    expect(result.mode).toBe("r2");
    if (result.mode !== "r2") return;
    expect(result.config.endpoint).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com`);
    expect(result.config.bucket).toBe("cliffies-media");
  });

  it.each(MEDIA_ENV)("half configured without %s: refused, naming it, never printing a secret", (name) => {
    const env: Record<string, string> = { ...fullEnv };
    delete env[name];
    const result = mediaConfig(env);
    expect(result.mode).toBe("error");
    const text = JSON.stringify(result);
    expect(text).toContain(name);
    expect(text).not.toContain(SECRET);
  });

  it("refuses a plain-http base, a query, a bad account id, a bad bucket name", () => {
    expect(mediaConfig({ ...fullEnv, MEDIA_BASE_URL: "http://media.cliffies.example" }).mode).toBe("error");
    expect(mediaBaseProblems("https://media.cliffies.example/?a=1")).toHaveLength(1);
    expect(mediaConfig({ ...fullEnv, R2_ACCOUNT_ID: "not-an-account" }).mode).toBe("error");
    expect(mediaConfig({ ...fullEnv, R2_BUCKET: "Bad_Bucket" }).mode).toBe("error");
    expect(mediaBaseProblems("http://127.0.0.1:3219")).toEqual([]);
  });
});

describe("names and URLs", () => {
  it("a base with a path puts it in front of the key", () => {
    expect(objectKey("https://pub-x.r2.dev", "content/series/a/hls/x.m4s")).toBe("content/series/a/hls/x.m4s");
    expect(objectKey("https://media.example/v1/", "/content/a")).toBe("v1/content/a");
    expect(mediaUrl("https://media.example/v1", "v1/content/a b.vtt")).toBe("https://media.example/v1/content/a%20b.vtt");
  });

  it("content-addressed names keep the extension last", () => {
    const sha = "1a2b3c4d5e6f7a8b9c0d";
    expect(hashedName("episode-1.webp", sha)).toBe("episode-1.1a2b3c4d5e6f.webp");
    expect(hashedName("episode-1.en.vtt", sha)).toBe("episode-1.en.1a2b3c4d5e6f.vtt");
    expect(() => hashedName("x.webp", "nope")).toThrow();
  });

  it("types for every published file, none for anything else", () => {
    expect(contentTypeOf("master.m3u8")).toBe("application/vnd.apple.mpegurl");
    expect(contentTypeOf("v0/seg_001.m4s")).toBe("video/iso.segment");
    expect(contentTypeOf("v0/init.mp4")).toBe("video/mp4");
    expect(contentTypeOf("episode-1.en.1a2b3c4d5e6f.vtt")).toBe("text/vtt; charset=utf-8");
    expect(contentTypeOf("manifest.json")).toBeNull();
  });

  it("the store caches exactly what the export caches for a revision folder: a year", () => {
    expect(cacheControlOf()).toBe(IMMUTABLE);
    const rules = parseHeadersFile(headersFile({ indexable: false })).rules;
    const exported = headersFor(rules, "/content/series/a/hls/episode-1/ab12cd34ef56/v0/index.m3u8", {});
    expect(exported["cache-control"]).toBe(cacheControlOf());
  });

  it("uploads media, then rendition playlists, then master.m3u8 alone", () => {
    expect(
      uploadPhases(["master.m3u8", "v1/index.m3u8", "v0/seg_001.m4s", "v0/init.mp4", "v0/index.m3u8"]),
    ).toEqual([["v0/init.mp4", "v0/seg_001.m4s"], ["v0/index.m3u8", "v1/index.m3u8"], ["master.m3u8"]]);
  });

  it("reports runner minutes as GitHub bills them: whole minutes, 2,000 free", () => {
    const report = minutesReport({ startedAtMs: 0, endedAtMs: 61 * 60_000 + 1, videoSeconds: 600 });
    expect(report.minutes).toBe(62);
    expect(report.perVideoMinute).toBeCloseTo(6.2);
    expect(report.runsPerMonth).toBe(32);
  });
});

describe("the R2 client against a store that checks signatures", () => {
  type Store = Awaited<ReturnType<typeof startFakeMediaStore>>;
  let fake: Store;
  const config = () => ({ endpoint: fake.endpoint, bucket: "cliffies-media", accessKeyId: "AKIDFAKE", secretAccessKey: SECRET });

  beforeEach(async () => {
    fake = await startFakeMediaStore({
      bucket: "cliffies-media",
      accessKeyId: "AKIDFAKE",
      secretAccessKey: SECRET,
      allowedOrigins: ["https://cliffies.example"],
    });
  });
  afterEach(async () => {
    await fake.close();
  });

  const folder = {
    "v0/init.mp4": Buffer.from("init"),
    "v0/seg_000.m4s": Buffer.from("segment zero"),
    "v0/seg_001.m4s": Buffer.from("segment one"),
    "v0/index.m3u8": Buffer.from("#EXTM3U\n"),
    "master.m3u8": Buffer.from("#EXTM3U\nv0/index.m3u8\n"),
  } as Record<string, Buffer>;
  const prefix = "content/series/demo/hls/episode-1/ab12cd34ef56";

  it("uploads a folder signed, typed and cached for a year, master playlist last", async () => {
    const store = createMediaStore(config());
    const done = await publishFolder(store, {
      keyPrefix: prefix,
      files: Object.keys(folder),
      read: (rel: string) => folder[rel] as Buffer,
    });
    expect(done).toEqual({ uploaded: 5, skipped: 0, bytes: Object.values(folder).reduce((sum, b) => sum + b.length, 0) });
    const puts = fake.log.filter((entry) => entry.method === "PUT");
    expect(puts.every((entry) => entry.status === 200)).toBe(true);
    expect(puts[puts.length - 1]?.key).toBe(`${prefix}/master.m3u8`);
    const master = fake.objects.get(`${prefix}/master.m3u8`);
    expect(master?.contentType).toBe("application/vnd.apple.mpegurl");
    expect(master?.cacheControl).toBe(IMMUTABLE);
    expect(fake.objects.get(`${prefix}/v0/seg_000.m4s`)?.body.toString()).toBe("segment zero");
  });

  it("skips a folder already there after ONE question, and single objects already there", async () => {
    const store = createMediaStore(config());
    await publishFolder(store, { keyPrefix: prefix, files: Object.keys(folder), read: (rel: string) => folder[rel] as Buffer });
    fake.log.length = 0;
    const again = await publishFolder(store, { keyPrefix: prefix, files: Object.keys(folder), read: (rel: string) => folder[rel] as Buffer });
    expect(again).toEqual({ uploaded: 0, skipped: 5, bytes: 0 });
    expect(fake.log.map((entry) => entry.method)).toEqual(["HEAD"]);

    const poster = await publishObject(store, "content/series/demo/posters/episode-1.1a2b3c4d5e6f.webp", () => Buffer.from("webp"));
    expect(poster.uploaded).toBe(1);
    const twice = await publishObject(store, "content/series/demo/posters/episode-1.1a2b3c4d5e6f.webp", () => Buffer.from("webp"));
    expect(twice).toEqual({ uploaded: 0, skipped: 1, bytes: 0 });
  });

  it("finishes a folder an earlier run left half-uploaded, without re-sending what is there", async () => {
    const store = createMediaStore(config());
    await store.put(`${prefix}/v0/init.mp4`, folder["v0/init.mp4"] as Buffer, { contentType: "video/mp4", cacheControl: IMMUTABLE });
    fake.log.length = 0;
    const done = await publishFolder(store, { keyPrefix: prefix, files: Object.keys(folder), read: (rel: string) => folder[rel] as Buffer });
    expect(done.uploaded).toBe(4);
    expect(done.skipped).toBe(1);
  });

  it("retries a store that is briefly down (503, 429), then succeeds", async () => {
    const store = createMediaStore(config(), { backoffMs: 1 });
    fake.failNext(503, 429);
    await store.put("content/x.vtt", Buffer.from("WEBVTT\n"), { contentType: "text/vtt; charset=utf-8", cacheControl: IMMUTABLE });
    expect(store.stats.retried).toBe(2);
    expect(fake.objects.has("content/x.vtt")).toBe(true);
  });

  it("gives up after its retries on a store that stays down", async () => {
    const store = createMediaStore(config(), { backoffMs: 1, retries: 2 });
    fake.failNext(503, 503, 503);
    await expect(store.head("content/x.vtt")).rejects.toMatchObject({ transient: true, status: 503 });
  });

  it("stops at once on a wrong secret: the store's own words, no retry, no secret in the message", async () => {
    const store = createMediaStore({ ...config(), secretAccessKey: "wrong" }, { backoffMs: 1 });
    const error = await store
      .put("content/x.vtt", Buffer.from("x"), { contentType: "text/vtt; charset=utf-8", cacheControl: IMMUTABLE })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MediaStoreError);
    expect(String((error as Error).message)).toContain("403");
    expect(String((error as Error).message)).toContain("SignatureDoesNotMatch");
    expect(String((error as Error).message)).not.toContain(SECRET);
    expect(store.stats.retried).toBe(0);
    expect(fake.objects.size).toBe(0);
  });

  it("the store refuses a body that is not the one that was signed", async () => {
    // Signed now: the store checks the clock before anything else, so the
    // date in the credential scope is today's, whenever this test runs.
    const datetime = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const response = await fetch(`${fake.endpoint}/cliffies-media/content/x`, {
      method: "PUT",
      headers: {
        authorization:
          `AWS4-HMAC-SHA256 Credential=AKIDFAKE/${datetime.slice(0, 8)}/auto/s3/aws4_request, ` +
          `SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${"0".repeat(64)}`,
        "x-amz-date": datetime,
        "x-amz-content-sha256": "0".repeat(64),
      },
      body: "tampered",
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("XAmzContentSHA256Mismatch");
  });

  it("keys with spaces and non-ASCII are signed as the store reads them", async () => {
    const store = createMediaStore(config());
    await store.put("content/series/demo/captions/épisode 1.en.1a2b3c4d5e6f.vtt", Buffer.from("WEBVTT\n"), {
      contentType: "text/vtt; charset=utf-8",
      cacheControl: IMMUTABLE,
    });
    expect(fake.objects.has("content/series/demo/captions/épisode 1.en.1a2b3c4d5e6f.vtt")).toBe(true);
  });

  it("the public side answers viewers with CORS for the site, none for other sites", async () => {
    const store = createMediaStore(config());
    await store.put(`${prefix}/master.m3u8`, Buffer.from("#EXTM3U\n"), {
      contentType: "application/vnd.apple.mpegurl",
      cacheControl: IMMUTABLE,
    });
    const ours = await fetch(`${fake.endpoint}/${prefix}/master.m3u8`, { headers: { origin: "https://cliffies.example" } });
    expect(ours.status).toBe(200);
    expect(ours.headers.get("access-control-allow-origin")).toBe("https://cliffies.example");
    expect(ours.headers.get("cache-control")).toBe(IMMUTABLE);
    const theirs = await fetch(`${fake.endpoint}/${prefix}/master.m3u8`, { headers: { origin: "https://elsewhere.example" } });
    expect(theirs.headers.get("access-control-allow-origin")).toBeNull();
  });
});
