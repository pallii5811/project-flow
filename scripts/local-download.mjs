#!/usr/bin/env node
/**
 * local-download.mjs — Download YouTube compilations from a residential IP
 * and upload them to R2 so Scaleway machines can process them without
 * hitting YouTube's bot detection.
 *
 * Usage:
 *   node scripts/local-download.mjs
 *
 * Reads failed_links.txt (or --file <path>), downloads each video with
 * yt-dlp, uploads the MP4 to R2 under deliveries/<slug>/delivery.mp4,
 * and writes the slug to stdout so the caller knows what succeeded.
 *
 * Requires environment variables:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *
 * The script asks for them interactively if they are not set.
 */
import { execFileSync, execSync } from "node:child_process";
import { createReadStream, statSync, existsSync, mkdirSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const ROOT = resolve(import.meta.dirname, "..");
const DOWNLOAD_DIR = join(ROOT, ".local-downloads");

// ── helpers ──────────────────────────────────────────────────────────────────

function slugFromUrl(url) {
  const match = url.match(/(?:youtu\.be\/|v=)([A-Za-z0-9_-]+)/);
  if (!match) return null;
  return `yt-${match[1].toLowerCase()}`;
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function ensureEnv(name, question) {
  if (process.env[name]) return process.env[name];
  const value = await ask(question);
  if (!value) { console.error(`${name} is required.`); process.exit(1); }
  process.env[name] = value;
  return value;
}

// ── R2 upload via S3 PutObject (pure Node, no SDK) ──────────────────────────

async function uploadToR2(filePath, key, config) {
  // Use aws cli compatible approach with fetch + AWS Signature V4
  // For simplicity and reliability, we use the @aws-sdk/client-s3 if available,
  // otherwise fall back to a direct HTTP PUT with signing.
  
  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
  const fileSize = statSync(filePath).size;
  
  console.error(`  uploading ${(fileSize / 1024 / 1024).toFixed(0)} MB to R2: ${key}`);

  // Use multipart upload via aws s3 cp command pattern with node's built-in fetch
  // Actually, the cleanest zero-dependency approach: use rclone or aws cli.
  // But since we want zero extra tools, let's use the S3 API directly.
  
  // Import the signing utilities
  const { createHash, createHmac } = await import("node:crypto");
  
  function sha256(data) {
    return createHash("sha256").update(data).digest("hex");
  }
  function hmac(key, data) {
    return createHmac("sha256", key).update(data).digest();
  }
  function hmacHex(key, data) {
    return createHmac("sha256", key).update(data).digest("hex");
  }

  // For files > 100MB, use multipart upload
  const PART_SIZE = 50 * 1024 * 1024; // 50 MB parts
  const parts = Math.ceil(fileSize / PART_SIZE);
  
  const region = "auto";
  const service = "s3";
  const host = `${config.bucket}.${config.accountId}.r2.cloudflarestorage.com`;

  function getSignatureKey(dateStamp) {
    let k = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
    k = hmac(k, region);
    k = hmac(k, service);
    k = hmac(k, "aws4_request");
    return k;
  }

  function signedRequest(method, path, headers, payloadHash, dateStamp, amzDate) {
    const canonicalHeaders = Object.entries(headers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join("\n") + "\n";
    const signedHeadersList = Object.keys(headers).sort().join(";");

    const canonicalRequest = [
      method,
      path,
      "", // no query string
      canonicalHeaders,
      signedHeadersList,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256(canonicalRequest),
    ].join("\n");

    const signingKey = getSignatureKey(dateStamp);
    const signature = hmacHex(signingKey, stringToSign);

    return {
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`,
    };
  }

  async function s3Fetch(method, path, body, extraHeaders = {}) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
    const dateStamp = amzDate.slice(0, 8);
    
    const payloadHash = body ? sha256(body) : "UNSIGNED-PAYLOAD";
    
    const headers = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...extraHeaders,
    };
    if (body) headers["content-length"] = String(body.length);
    
    const { authorization } = signedRequest(method, path, headers, payloadHash, dateStamp, amzDate);
    headers["authorization"] = authorization;
    
    const url = `https://${host}${path}`;
    const resp = await fetch(url, { method, headers, body: body || undefined });
    return resp;
  }

  if (fileSize <= PART_SIZE) {
    // Simple PUT for small files
    const { readFileSync } = await import("node:fs");
    const fileData = readFileSync(filePath);
    
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256(fileData);
    
    const headers = {
      "content-type": "video/mp4",
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    headers["content-length"] = String(fileData.length);
    
    const { authorization } = signedRequest("PUT", `/${key}`, headers, payloadHash, dateStamp, amzDate);
    headers["authorization"] = authorization;
    
    const resp = await fetch(`https://${host}/${key}`, {
      method: "PUT",
      headers,
      body: fileData,
    });
    
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`R2 PUT failed (${resp.status}): ${text}`);
    }
    console.error(`  ✓ uploaded ${key}`);
    return;
  }

  // Multipart upload for large files
  // 1. Initiate
  const initResp = await s3Fetch("POST", `/${key}?uploads=`, null, { "content-type": "video/mp4" });
  if (!initResp.ok) {
    const text = await initResp.text();
    throw new Error(`R2 initiate multipart failed (${initResp.status}): ${text}`);
  }
  const initXml = await initResp.text();
  const uploadIdMatch = initXml.match(/<UploadId>(.+?)<\/UploadId>/);
  if (!uploadIdMatch) throw new Error("No UploadId in response");
  const uploadId = uploadIdMatch[1];
  
  console.error(`  multipart upload started (${parts} parts of ${PART_SIZE / 1024 / 1024} MB)`);
  
  // 2. Upload parts
  const { openSync, readSync, closeSync } = await import("node:fs");
  const fd = openSync(filePath, "r");
  const etags = [];
  
  try {
    for (let i = 0; i < parts; i++) {
      const start = i * PART_SIZE;
      const end = Math.min(start + PART_SIZE, fileSize);
      const size = end - start;
      const buf = Buffer.alloc(size);
      readSync(fd, buf, 0, size, start);
      
      const partNum = i + 1;
      const now = new Date();
      const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
      const dateStamp = amzDate.slice(0, 8);
      const payloadHash = sha256(buf);
      
      const path = `/${key}?partNumber=${partNum}&uploadId=${encodeURIComponent(uploadId)}`;
      
      const headers = {
        "content-length": String(size),
        host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
      };
      
      // For multipart, query string must be in canonical request
      const canonicalHeaders = Object.entries(headers)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join("\n") + "\n";
      const signedHeadersList = Object.keys(headers).sort().join(";");
      const queryString = `partNumber=${partNum}&uploadId=${encodeURIComponent(uploadId)}`;
      
      const canonicalRequest = [
        "PUT",
        `/${key}`,
        queryString,
        canonicalHeaders,
        signedHeadersList,
        payloadHash,
      ].join("\n");
      
      const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
      const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        sha256(canonicalRequest),
      ].join("\n");
      
      const signingKey = getSignatureKey(dateStamp);
      const signature = hmacHex(signingKey, stringToSign);
      headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;
      
      const resp = await fetch(`https://${host}/${key}?partNumber=${partNum}&uploadId=${encodeURIComponent(uploadId)}`, {
        method: "PUT",
        headers,
        body: buf,
      });
      
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Part ${partNum} failed (${resp.status}): ${text}`);
      }
      
      const etag = resp.headers.get("etag");
      etags.push({ partNum, etag });
      console.error(`  part ${partNum}/${parts} ✓`);
    }
  } finally {
    closeSync(fd);
  }
  
  // 3. Complete multipart
  const completeXml = `<CompleteMultipartUpload>${etags.map(({ partNum, etag }) => `<Part><PartNumber>${partNum}</PartNumber><ETag>${etag}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
  
  const completeResp = await s3Fetch("POST", `/${key}?uploadId=${encodeURIComponent(uploadId)}`, Buffer.from(completeXml), { "content-type": "application/xml" });
  if (!completeResp.ok) {
    const text = await completeResp.text();
    throw new Error(`Complete multipart failed (${completeResp.status}): ${text}`);
  }
  console.error(`  ✓ uploaded ${key} (${parts} parts)`);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const linksFile = process.argv.includes("--file")
    ? process.argv[process.argv.indexOf("--file") + 1]
    : join(ROOT, "failed_links.txt");

  if (!existsSync(linksFile)) {
    console.error(`No file at ${linksFile}`);
    process.exit(1);
  }

  const urls = readFileSync(linksFile, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  console.error(`\n📥 ${urls.length} videos to download from your PC and upload to R2\n`);

  // Ensure R2 credentials
  const accountId = await ensureEnv("R2_ACCOUNT_ID", "R2_ACCOUNT_ID (32-char hex from Cloudflare dashboard): ");
  const accessKeyId = await ensureEnv("R2_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID: ");
  const secretAccessKey = await ensureEnv("R2_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY: ");
  const bucket = await ensureEnv("R2_BUCKET", "R2_BUCKET: ");

  const r2Config = { accountId, accessKeyId, secretAccessKey, bucket };

  mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const succeeded = [];
  const failed = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const slug = slugFromUrl(url);
    if (!slug) {
      console.error(`⚠ Cannot extract slug from: ${url}`);
      failed.push(url);
      continue;
    }

    console.error(`\n[${i + 1}/${urls.length}] ${slug}`);
    const outPath = join(DOWNLOAD_DIR, `${slug}.mp4`);

    // Download with yt-dlp (local residential IP)
    if (!existsSync(outPath)) {
      try {
        console.error(`  downloading from YouTube...`);
        execFileSync("yt-dlp", [
          "--format", "bestvideo*+bestaudio/best",
          "--merge-output-format", "mp4",
          "--retries", "5",
          "--fragment-retries", "10",
          "-o", outPath,
          url,
        ], { stdio: ["pipe", "pipe", "inherit"], timeout: 30 * 60 * 1000 });
        console.error(`  ✓ downloaded ${(statSync(outPath).size / 1024 / 1024).toFixed(0)} MB`);
      } catch (err) {
        console.error(`  ✗ download failed: ${err.message}`);
        failed.push(url);
        continue;
      }
    } else {
      console.error(`  ✓ already downloaded (${(statSync(outPath).size / 1024 / 1024).toFixed(0)} MB)`);
    }

    // Upload to R2
    const r2Key = `deliveries/${slug}/delivery.mp4`;
    try {
      await uploadToR2(outPath, r2Key, r2Config);
      succeeded.push({ url, slug, r2Key });
      console.log(slug); // stdout: machine-readable list of ready slugs
    } catch (err) {
      console.error(`  ✗ upload failed: ${err.message}`);
      failed.push(url);
    }
  }

  console.error(`\n────────────────────────────────────────`);
  console.error(`✓ ${succeeded.length} uploaded to R2`);
  if (failed.length) console.error(`✗ ${failed.length} failed: ${failed.join(", ")}`);
  console.error(`\nNext step: run the batch ingest to process these from R2.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
