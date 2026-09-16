/**
 * Fails when a text file in the repository contains an invisible control byte.
 *
 * Tool layers interpret escape sequences before a file is written: a NUL or a
 * backspace typed as an escape into a patch lands as a real byte, the code
 * still compiles, the tests may still pass, and nobody sees it in a diff.
 * This check makes the hunt repeatable instead of depending on attention.
 *
 * Scans tracked files plus new, not-ignored ones, so it catches the byte
 * before the commit. Allowed: tab (0x09), line feed (0x0A), carriage return
 * (0x0D). Binary formats are skipped by extension; an unknown binary format
 * fails loudly and gets added to BINARY_EXTENSIONS on purpose.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".mp4",
  ".m4s",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".pdf",
]);

function isControlByte(byte) {
  if (byte === 0x09 || byte === 0x0a || byte === 0x0d) return false;
  return byte < 0x20 || byte === 0x7f;
}

function extensionOf(path) {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

const listed = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { cwd: repoRoot, encoding: "utf8" },
);
const files = [...new Set(listed.split("\0").filter(Boolean))];

const findings = [];
for (const file of files) {
  if (BINARY_EXTENSIONS.has(extensionOf(file))) continue;
  let bytes;
  try {
    bytes = readFileSync(join(repoRoot, file));
  } catch (error) {
    // Deleted in the working tree but still in the index: nothing to scan.
    if (error && error.code === "ENOENT") continue;
    throw error;
  }
  let line = 1;
  for (const byte of bytes) {
    if (byte === 0x0a) line += 1;
    else if (isControlByte(byte)) {
      findings.push(`${file}:${line}  byte 0x${byte.toString(16).padStart(2, "0")}`);
    }
  }
}

if (findings.length > 0) {
  console.error(`Control bytes found in ${findings.length} place(s):`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.error(`check-control-bytes: ${files.length} files clean`);
