/**
 * Downloads what a studio sent, on the machine that will process it — never
 * on the owner's, whose connection is a phone's (docs/cloud-ingest.md).
 *
 *   node scripts/fetch-delivery.mjs --out <folder> <link> [<link> …]
 *
 * Handles a Dropbox share link, a Google Drive file shared with "anyone with
 * the link" (including the confirmation page a large file answers with), a
 * WeTransfer download link, and a plain https address. A link that needs
 * someone to log in is refused in one line instead of saving the login page
 * as if it were a video. A .zip is unpacked (a delivery of one file per
 * episode often arrives that way).
 *
 * Nothing about the files is trusted: the name is made safe, the type must
 * not be a web page, and every byte is counted against the free disk.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  classifyLink,
  driveConfirmUrl,
  filenameFromResponse,
  looksLikeAFile,
  wetransferRequest,
} from "./lib/delivery-links.mjs";

const args = process.argv.slice(2);

function die(message) {
  console.error(`fetch-delivery: ${message}`);
  process.exit(1);
}

function flag(name) {
  const at = args.indexOf(name);
  if (at === -1) return null;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) die(`${name} needs a value`);
  return value;
}

const outFlag = flag("--out");
if (!outFlag) die("--out <folder> is required");
const out = resolve(outFlag);
const links = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--out");
if (links.length === 0) die("give at least one link");
mkdirSync(out, { recursive: true });

function freeBytes() {
  try {
    const stats = statfsSync(out);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

async function ask(url, options = {}) {
  const response = await fetch(url, {
    redirect: "follow",
    ...options,
    headers: {
      // Some hosts answer a player page to anything that does not look like a browser.
      "user-agent": "Mozilla/5.0 (compatible; cliffies-ingest/1; +https://github.com/pallii5811/project-flow)",
      ...(options.headers ?? {}),
    },
  });
  return response;
}

/** Saves the body, telling how it is going, and refuses to fill the disk. */
async function save(response, target) {
  const length = Number(response.headers.get("content-length"));
  const free = freeBytes();
  if (Number.isFinite(length) && free !== null && length + 2e9 > free) {
    die(
      `the file is ${(length / 1e9).toFixed(1)} GB and only ${(free / 1e9).toFixed(1)} GB are free: ` +
        "it would not leave room to cut and package it. Ask for a smaller delivery.",
    );
  }
  const partial = `${target}.partial`;
  rmSync(partial, { force: true });
  const hash = createHash("sha256");
  let written = 0;
  let lastSaid = Date.now();
  const counted = new Transform({
    transform(chunk, _encoding, next) {
      written += chunk.length;
      hash.update(chunk);
      if (Date.now() - lastSaid > 15_000) {
        lastSaid = Date.now();
        const total = Number.isFinite(length) ? ` of ${(length / 1e9).toFixed(2)} GB` : "";
        console.error(`fetch-delivery: ${(written / 1e9).toFixed(2)} GB${total} …`);
      }
      next(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), counted, createWriteStream(partial));
  if (Number.isFinite(length) && written !== length) {
    rmSync(partial, { force: true });
    die(`the download stopped at ${written} of ${length} bytes: run the workflow again`);
  }
  renameSync(partial, target);
  return { bytes: written, sha256: hash.digest("hex") };
}

/** A zip of episodes: unpacked next to it, then removed. */
function unzip(path) {
  const result = spawnSync("unzip", ["-o", "-j", path, "-d", out], { encoding: "utf8" });
  if (result.status !== 0) {
    die(`${basename(path)} is a zip this machine could not unpack: ${(result.stderr ?? "").slice(-300)}`);
  }
  rmSync(path, { force: true });
  console.error(`fetch-delivery: ${basename(path)} unpacked`);
}

async function fetchOne(raw, index) {
  const link = classifyLink(raw);
  if (link.kind === "unusable") die(`${link.problem}\n  Link: ${raw}`);
  if (link.note) console.error(`fetch-delivery: ${link.note}`);
  let response;
  let url = link.url;

  if (link.kind === "wetransfer") {
    const request = wetransferRequest(link);
    const answer = await ask(request.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "XMLHttpRequest" },
      body: JSON.stringify(request.body),
    });
    if (!answer.ok) {
      die(
        `WeTransfer answered ${answer.status} for this transfer: it has probably expired (they last a week), ` +
          "or it is protected by a password. Ask for it again.",
      );
    }
    const data = await answer.json().catch(() => ({}));
    if (!data.direct_link) die("WeTransfer gave no direct link for this transfer: ask the studio to send it again");
    url = data.direct_link;
    response = await ask(url);
  } else if (link.kind === "drive") {
    response = await ask(url);
    const type = response.headers.get("content-type") ?? "";
    if (type.toLowerCase().startsWith("text/html")) {
      // The "we cannot scan this file" page: it says where to ask instead.
      const confirm = driveConfirmUrl(await response.text(), link.id);
      if (!confirm) {
        die(
          "Google Drive answered a page: the file is not shared with 'anyone with the link', or the link is a folder. " +
            "Ask the studio to set 'Anyone with the link' on the file itself.",
        );
      }
      response = await ask(confirm);
    }
  } else {
    response = await ask(url);
  }

  const verdict = looksLikeAFile({
    status: response.status,
    contentType: response.headers.get("content-type"),
    contentLength: response.headers.get("content-length"),
  });
  if (!verdict.ok) die(`${verdict.problem}\n  Link: ${raw}`);

  const name = filenameFromResponse({
    disposition: response.headers.get("content-disposition"),
    url: response.url || url,
    fallback: `delivery-${index + 1}.mp4`,
  });
  const target = join(out, name);
  console.error(`fetch-delivery: ${link.kind} → ${name}`);
  const saved = await save(response, target);
  console.error(
    `fetch-delivery: ${name}, ${(saved.bytes / 1e9).toFixed(2)} GB, sha256 ${saved.sha256.slice(0, 16)}…`,
  );
  if (extname(target).toLowerCase() === ".zip") unzip(target);
}

for (const [index, raw] of links.entries()) await fetchOne(raw, index);

const files = existsSync(out) ? readdirSync(out).map((name) => join(out, name)) : [];
console.error(
  `fetch-delivery: ${files.length} file(s) in ${out}:\n` +
    files.map((file) => `  ${basename(file)}  ${(statSync(file).size / 1e6).toFixed(1)} MB`).join("\n"),
);
