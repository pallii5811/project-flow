/**
 * Serves a static export the way Cloudflare Pages does, for local checks of
 * the exact files that will be published. Zero dependencies.
 *
 *   node scripts/serve-static.mjs apps/web/out 3100
 *
 * Routing, in order: exact file → path + ".html" → path + "/index.html" →
 * 404.html with status 404. Byte ranges are honored (Safari refuses to play
 * video without them).
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const [, , dirArg = "apps/web/out", portArg = "3100"] = process.argv;
const root = resolve(dirArg);
const port = Number(portArg);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".m4s": "video/iso.segment",
  ".m3u8": "application/vnd.apple.mpegurl",
};

function fileAt(path) {
  try {
    const stats = statSync(path);
    return stats.isFile() ? { path, size: stats.size } : null;
  } catch {
    return null;
  }
}

function resolveRequest(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const candidate = normalize(join(root, decoded));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return (
    fileAt(candidate) ??
    fileAt(`${candidate}.html`) ??
    fileAt(join(candidate, "index.html"))
  );
}

const server = createServer((request, response) => {
  let status = 200;
  let file = resolveRequest(request.url ?? "/");
  if (!file) {
    status = 404;
    file = fileAt(join(root, "404.html"));
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("404");
      return;
    }
  }

  const headers = {
    "content-type": MIME[extname(file.path).toLowerCase()] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  if (status === 200 && range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, file.size - Number(range[2]));
    const end =
      range[1] && range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
    if (start > end || start >= file.size) {
      response.writeHead(416, { "content-range": `bytes */${file.size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      ...headers,
      "content-range": `bytes ${start}-${end}/${file.size}`,
      "content-length": end - start + 1,
    });
    if (request.method === "HEAD") return response.end();
    send(createReadStream(file.path, { start, end }), response);
    return;
  }

  response.writeHead(status, { ...headers, "content-length": file.size });
  if (request.method === "HEAD") return response.end();
  send(createReadStream(file.path), response);
});

/**
 * A viewer who swipes away mid-segment aborts the request. An unhandled
 * stream error would then take the whole server down, which shows up minutes
 * later as a page that will not load and hides its own cause.
 */
function send(stream, response) {
  stream.on("error", () => response.destroy());
  response.on("close", () => stream.destroy());
  stream.pipe(response);
}

server.on("clientError", (_error, socket) => socket.destroy());

server.listen(port, () => {
  console.error(`serve-static: ${root} on http://localhost:${port}`);
});
