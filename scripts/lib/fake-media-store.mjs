/**
 * A local stand-in for Cloudflare R2, for tests and proofs only: an HTTP
 * server that speaks the two S3 verbs ingest uses and checks every request
 * the way the real store does.
 *
 *   - Signed API, path-style /<bucket>/<key>: HEAD and PUT must carry a valid
 *     AWS Signature Version 4 (recomputed here, from the request as it
 *     arrived, with its own canonicalisation — not by calling the signer it
 *     is testing), a date within 15 minutes, and a body whose sha256 is the
 *     x-amz-content-sha256 it was signed with. Otherwise 403 or 400, as R2.
 *   - Public reads, /<key> with no Authorization: GET and HEAD of stored
 *     objects with their Content-Type and Cache-Control, and CORS headers
 *     for the allowed origins — what a custom domain in front of a bucket
 *     with a CORS rule answers (docs/cloud-ingest.md).
 *
 * Every request is recorded, and `failNext` makes the next requests fail
 * with a status, to prove retries.
 */
import { Buffer } from "node:buffer";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function rfc3986(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * @param {{ bucket: string, accessKeyId: string, secretAccessKey: string, allowedOrigins?: string[] }} options
 */
export function startFakeMediaStore({ bucket, accessKeyId, secretAccessKey, allowedOrigins = [], port = 0 }) {
  const objects = new Map();
  const log = [];
  let failures = [];

  function refuse(response, status, code, message) {
    response.writeHead(status, { "content-type": "application/xml" });
    response.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`);
    return { status, code };
  }

  /** Recomputes the signature from the request as received. */
  function verify(request, body) {
    const auth = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(
      request.headers.authorization ?? "",
    );
    if (!auth) return { status: 400, code: "AuthorizationHeaderMalformed" };
    const [, key, date, region, service, signedList, signature] = auth;
    if (key !== accessKeyId) return { status: 403, code: "InvalidAccessKeyId" };
    if (region !== "auto" || service !== "s3") return { status: 400, code: "AuthorizationHeaderMalformed" };
    const amzDate = request.headers["x-amz-date"] ?? "";
    if (!amzDate.startsWith(date)) return { status: 400, code: "AuthorizationHeaderMalformed" };
    const when = Date.parse(
      `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`,
    );
    if (!Number.isFinite(when) || Math.abs(Date.now() - when) > 15 * 60_000) {
      return { status: 403, code: "RequestTimeTooSkewed" };
    }
    const payloadHash = request.headers["x-amz-content-sha256"];
    if (!payloadHash) return { status: 400, code: "MissingContentSHA256" };
    if (payloadHash !== "UNSIGNED-PAYLOAD" && payloadHash !== sha256(body)) {
      return { status: 400, code: "XAmzContentSHA256Mismatch" };
    }
    const names = signedList.split(";");
    for (const required of ["host", "x-amz-content-sha256", "x-amz-date"]) {
      if (!names.includes(required)) return { status: 400, code: "AuthorizationHeaderMalformed" };
    }
    const [rawPath, rawQuery = ""] = (request.url ?? "/").split("?");
    const canonicalPath = rawPath
      .split("/")
      .map((segment) => rfc3986(decodeURIComponent(segment)))
      .join("/");
    const canonical = [
      request.method,
      canonicalPath,
      rawQuery,
      ...names.map((name) => `${name}:${String(request.headers[name] ?? "").trim().replace(/\s+/g, " ")}`),
      "",
      signedList,
      payloadHash,
    ].join("\n");
    const scope = `${date}/auto/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), "auto"), "s3"), "aws4_request");
    const expected = createHmac("sha256", signingKey).update(toSign).digest("hex");
    return expected === signature ? null : { status: 403, code: "SignatureDoesNotMatch" };
  }

  function corsHeaders(request) {
    const origin = request.headers.origin;
    if (!origin || !(allowedOrigins.includes("*") || allowedOrigins.includes(origin))) return {};
    return { "access-control-allow-origin": allowedOrigins.includes("*") ? "*" : origin, vary: "Origin" };
  }

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = decodeURIComponent((request.url ?? "/").split("?")[0]);
      const entry = { method: request.method, path, status: 0, signed: Boolean(request.headers.authorization) };
      log.push(entry);

      if (failures.length > 0 && request.headers.authorization) {
        const status = failures.shift();
        entry.status = status;
        return refuse(response, status, "Injected", "injected failure");
      }

      if (!request.headers.authorization) {
        // The public side: what viewers' browsers read.
        const object = objects.get(path.replace(/^\//, ""));
        if (request.method === "OPTIONS") {
          entry.status = 204;
          response.writeHead(204, { ...corsHeaders(request), "access-control-allow-methods": "GET, HEAD" });
          return response.end();
        }
        if (!object || !["GET", "HEAD"].includes(request.method)) {
          entry.status = 404;
          response.writeHead(404, corsHeaders(request));
          return response.end();
        }
        entry.status = 200;
        response.writeHead(200, {
          "content-type": object.contentType,
          "cache-control": object.cacheControl,
          "content-length": object.body.length,
          etag: object.etag,
          ...corsHeaders(request),
        });
        return response.end(request.method === "HEAD" ? undefined : object.body);
      }

      const problem = verify(request, body);
      if (problem) {
        entry.status = problem.status;
        return refuse(response, problem.status, problem.code, problem.code);
      }
      const prefix = `/${bucket}/`;
      if (!path.startsWith(prefix)) {
        entry.status = 404;
        return refuse(response, 404, "NoSuchBucket", "NoSuchBucket");
      }
      const key = path.slice(prefix.length);
      entry.key = key;
      if (request.method === "PUT") {
        const etag = `"${createHash("md5").update(body).digest("hex")}"`;
        objects.set(key, {
          body,
          etag,
          contentType: request.headers["content-type"] ?? "application/octet-stream",
          cacheControl: request.headers["cache-control"] ?? "",
        });
        entry.status = 200;
        response.writeHead(200, { etag });
        return response.end();
      }
      if (request.method === "HEAD") {
        const object = objects.get(key);
        entry.status = object ? 200 : 404;
        response.writeHead(entry.status, object ? { etag: object.etag, "content-length": object.body.length } : {});
        return response.end();
      }
      entry.status = 405;
      return refuse(response, 405, "MethodNotAllowed", "MethodNotAllowed");
    });
  });

  return new Promise((resolveStart) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolveStart({
        endpoint: `http://127.0.0.1:${address.port}`,
        port: address.port,
        objects,
        log,
        failNext(...statuses) {
          failures = [...failures, ...statuses];
        },
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
