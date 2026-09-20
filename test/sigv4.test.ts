/**
 * The request signer that uploads media to R2 (scripts/lib/sigv4.mjs), proven
 * against vectors AWS publishes rather than against itself.
 *
 *   - the SigV4 test suite (test/fixtures/sigv4/, from awslabs/aws-c-auth):
 *     canonical request, string to sign and signature must all match;
 *   - the four worked examples of the Amazon S3 API reference, "Signature
 *     Calculations for the Authorization Header: Transferring Payload in a
 *     Single Chunk" (credentials AKIAIOSFODNN7EXAMPLE, 24 May 2013): the S3
 *     rules differ (the path is encoded once and never normalised), and R2
 *     speaks S3.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EMPTY_SHA256,
  amzDate,
  canonicalUri,
  signRequest,
  uriEncode,
} from "../scripts/lib/sigv4.mjs";

const suite = join(__dirname, "fixtures", "sigv4");
const cases = readdirSync(suite, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

type Context = {
  credentials: { access_key_id: string; secret_access_key: string; token?: string };
  normalize: boolean;
  region: string;
  service: string;
  sign_body: boolean;
  timestamp: string;
};

/** request.txt: "METHOD target HTTP/1.1", "Name:value" lines, a blank line, the body. */
function parseRequest(text: string) {
  const [head = "", ...rest] = text.split("\n");
  const blank = rest.indexOf("");
  const headerLines = blank === -1 ? rest : rest.slice(0, blank);
  const body = blank === -1 ? "" : rest.slice(blank + 1).join("\n");
  const method = head.slice(0, head.indexOf(" "));
  const target = head.slice(head.indexOf(" ") + 1, head.lastIndexOf(" HTTP/"));
  const at = target.indexOf("?");
  const headers: [string, string][] = headerLines
    .filter((line) => line.length > 0)
    .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1)]);
  return {
    method,
    path: at === -1 ? target : target.slice(0, at),
    query: at === -1 ? "" : target.slice(at + 1),
    headers,
    body,
  };
}

const read = (name: string, file: string) => readFileSync(join(suite, name, file), "utf8").replace(/\n$/, "");

describe("SigV4 against the AWS test suite", () => {
  it("has the suite on disk", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(cases)("%s", (name) => {
    const context = JSON.parse(read(name, "context.json")) as Context;
    const request = parseRequest(readFileSync(join(suite, name, "request.txt"), "utf8"));
    const datetime = amzDate(new Date(context.timestamp));
    const bodyHash = createHash("sha256").update(request.body).digest("hex");
    const headers: [string, string][] = [...request.headers, ["X-Amz-Date", datetime]];
    if (context.credentials.token) headers.push(["X-Amz-Security-Token", context.credentials.token]);
    if (context.sign_body) headers.push(["X-Amz-Content-Sha256", bodyHash]);

    const signed = signRequest({
      method: request.method,
      path: request.path,
      query: request.query,
      headers,
      payloadHash: bodyHash,
      credentials: {
        accessKeyId: context.credentials.access_key_id,
        secretAccessKey: context.credentials.secret_access_key,
      },
      region: context.region,
      service: context.service,
      datetime,
      normalize: context.normalize,
    });
    expect(signed.canonicalRequest).toBe(read(name, "header-canonical-request.txt"));
    expect(signed.stringToSign).toBe(read(name, "header-string-to-sign.txt"));
    expect(signed.signature).toBe(read(name, "header-signature.txt"));
  });
});

describe("SigV4 for S3 (the Amazon S3 API reference examples)", () => {
  const credentials = {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  };
  const datetime = "20130524T000000Z";
  const host = "examplebucket.s3.amazonaws.com";
  const sign = (method: string, path: string, query: string, extra: [string, string][], payloadHash: string) =>
    signRequest({
      method,
      path,
      query,
      headers: [["Host", host], ["x-amz-date", datetime], ["x-amz-content-sha256", payloadHash], ...extra],
      payloadHash,
      credentials,
      region: "us-east-1",
      service: "s3",
      datetime,
      s3: true,
    });

  it("GET Object with a Range header", () => {
    const signed = sign("GET", "/test.txt", "", [["Range", "bytes=0-9"]], EMPTY_SHA256);
    expect(signed.canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "",
        `host:${host}`,
        "range:bytes=0-9",
        `x-amz-content-sha256:${EMPTY_SHA256}`,
        `x-amz-date:${datetime}`,
        "",
        "host;range;x-amz-content-sha256;x-amz-date",
        EMPTY_SHA256,
      ].join("\n"),
    );
    expect(signed.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  it("PUT Object: a key with $ is encoded once, the body hash is signed", () => {
    const body = "Welcome to Amazon S3.";
    const payload = createHash("sha256").update(body).digest("hex");
    expect(payload).toBe("44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
    const signed = sign(
      "PUT",
      "/test$file.text",
      "",
      [
        ["Date", "Fri, 24 May 2013 00:00:00 GMT"],
        ["x-amz-storage-class", "REDUCED_REDUNDANCY"],
      ],
      payload,
    );
    expect(signed.canonicalRequest.split("\n")[1]).toBe("/test%24file.text");
    expect(signed.signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  it("GET Bucket Lifecycle: a query name without a value", () => {
    expect(sign("GET", "/", "lifecycle", [], EMPTY_SHA256).signature).toBe(
      "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543",
    );
  });

  it("GET Bucket (List Objects): query parameters sorted", () => {
    expect(sign("GET", "/", "max-keys=2&prefix=J", [], EMPTY_SHA256).signature).toBe(
      "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
    );
  });

  it("never normalises an S3 key: '//' and '/./' are other keys", () => {
    expect(canonicalUri("/a//b/./c", { s3: true })).toBe("/a//b/./c");
    expect(canonicalUri("/a//b/./c", { s3: false })).toBe("/a/b/c");
  });

  it("encodes like RFC 3986, uppercase hex, UTF-8 bytes", () => {
    expect(uriEncode("a b+c/é~")).toBe("a%20b%2Bc%2F%C3%A9~");
    expect(uriEncode("a/b", { keepSlash: true })).toBe("a/b");
  });
});
