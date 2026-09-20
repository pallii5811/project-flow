/**
 * AWS Signature Version 4, the signing that Cloudflare R2's S3-compatible
 * API accepts, in plain Node with no dependency.
 *
 * Proven against the test suite AWS publishes (awslabs/aws-c-auth,
 * tests/aws-signing-test-suite/v4, copied into test/fixtures/sigv4/) and
 * against the worked S3 examples of the Amazon S3 API reference
 * ("Signature Calculations for the Authorization Header"): test/sigv4.test.ts.
 *
 * Two ways a path becomes canonical, and the difference matters:
 *   - most AWS services: the path as sent, normalised, then URI-encoded
 *     AGAIN (a "%20" on the wire becomes "%2520");
 *   - S3 (and R2): the path encoded exactly once, never normalised, because
 *     an object key may contain "//" or "/./" and still be a different key.
 */
import { Buffer } from "node:buffer";
import { createHash, createHmac } from "node:crypto";

export const ALGORITHM = "AWS4-HMAC-SHA256";
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC 3986: every byte except A–Z a–z 0–9 - . _ ~ is %XX (uppercase). */
export function uriEncode(value, { keepSlash = false } = {}) {
  let out = "";
  for (const byte of Buffer.from(String(value), "utf8")) {
    const char = String.fromCharCode(byte);
    if (
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      (byte >= 0x30 && byte <= 0x39) ||
      char === "-" ||
      char === "." ||
      char === "_" ||
      char === "~" ||
      (keepSlash && char === "/")
    ) {
      out += char;
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/** Removes "." and ".." segments and repeated slashes (RFC 3986 §5.2.4, as the suite expects). */
export function normalizePath(path) {
  const segments = [];
  const parts = String(path).split("/");
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  const trailing = /\/(\.{0,2})?$/.test(path) && segments.length > 0 ? "/" : "";
  return `/${segments.join("/")}${trailing}`;
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * @param {string} path  the path as sent on the wire
 * @param {{ s3?: boolean, normalize?: boolean }} options
 */
export function canonicalUri(path, { s3 = false, normalize = true } = {}) {
  const raw = path === "" ? "/" : path;
  if (s3) {
    return raw
      .split("/")
      .map((segment) => uriEncode(decodeSegment(segment)))
      .join("/");
  }
  const normalized = normalize ? normalizePath(raw) : raw;
  return uriEncode(normalized, { keepSlash: true });
}

/** "b=2&a=1&a=0" → "a=0&a=1&b=2", each name and value encoded once. */
export function canonicalQuery(query) {
  if (!query) return "";
  const pairs = String(query)
    .split("&")
    .filter((part) => part.length > 0)
    .map((part) => {
      const at = part.indexOf("=");
      const name = at === -1 ? part : part.slice(0, at);
      const value = at === -1 ? "" : part.slice(at + 1);
      return [uriEncode(decodeSegment(name)), uriEncode(decodeSegment(value))];
    });
  pairs.sort(([an, av], [bn, bv]) => (an < bn ? -1 : an > bn ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  return pairs.map(([name, value]) => `${name}=${value}`).join("&");
}

/**
 * Header list → canonical headers and the signed-header list. Names are
 * lowercased; values trimmed with inner runs of spaces collapsed; a header
 * sent twice is one line with its values joined by commas, in the order sent.
 *
 * @param {[string, string][]} headers
 */
export function canonicalHeaders(headers) {
  const byName = new Map();
  for (const [name, value] of headers) {
    const key = name.trim().toLowerCase();
    const clean = String(value).trim().replace(/\s+/g, " ");
    byName.set(key, byName.has(key) ? `${byName.get(key)},${clean}` : clean);
  }
  const names = [...byName.keys()].sort();
  return {
    canonical: names.map((name) => `${name}:${byName.get(name)}\n`).join(""),
    signed: names.join(";"),
  };
}

export function signingKey(secretAccessKey, date, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/** A Date → "20150830T123600Z". */
export function amzDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Signs one request. The headers passed must already include `host` and
 * `x-amz-date` (and `x-amz-content-sha256` for S3): what is signed is exactly
 * what is listed, nothing is added behind the caller's back.
 *
 * @param {object} request
 * @param {string} request.method
 * @param {string} request.path     as sent on the wire, without the query
 * @param {string} [request.query]  as sent, without "?"
 * @param {[string, string][]} request.headers
 * @param {string} request.payloadHash  hex sha256 of the body (or UNSIGNED-PAYLOAD)
 * @param {{ accessKeyId: string, secretAccessKey: string }} request.credentials
 * @param {string} request.region
 * @param {string} request.service
 * @param {string} request.datetime  "YYYYMMDDTHHMMSSZ"
 * @param {boolean} [request.s3]
 * @param {boolean} [request.normalize]
 */
export function signRequest(request) {
  const { method, path, query = "", headers, payloadHash, credentials, region, service, datetime } = request;
  const date = datetime.slice(0, 8);
  const { canonical, signed } = canonicalHeaders(headers);
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(path, { s3: request.s3 === true, normalize: request.normalize !== false }),
    canonicalQuery(query),
    canonical,
    signed,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [ALGORITHM, datetime, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(credentials.secretAccessKey, date, region, service))
    .update(stringToSign, "utf8")
    .digest("hex");
  return {
    canonicalRequest,
    stringToSign,
    signature,
    signedHeaders: signed,
    authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  };
}
