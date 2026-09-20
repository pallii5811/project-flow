/**
 * What a studio's link is, and how to get the file behind it — the deciding
 * part, as pure functions (tested in test/delivery-links.test.ts; the
 * downloading itself is scripts/fetch-delivery.mjs).
 *
 * The rule that runs through all of it: **a link that needs someone to log in
 * cannot work on a machine nobody is sitting at**, and must say so in one
 * line instead of downloading a login page and calling it a video. Studios
 * send four kinds of link:
 *
 *   - Dropbox: a shared file link plays in a viewer; `dl=1` gives the file. A
 *     folder link gives a .zip of the folder, which is fine for a delivery of
 *     one episode per file.
 *   - Google Drive: a file shared with "anyone with the link" downloads from
 *     drive.usercontent.google.com; a large file first answers with a page
 *     asking to confirm the virus scan, and that page carries the address to
 *     ask for instead. A folder, or a file shared with named people only,
 *     needs a login: refused.
 *   - WeTransfer: the download page is not the file. The page's id and
 *     security hash ask their API for a direct link, which works while the
 *     transfer lives (a week). Anything else — a link that has expired, or a
 *     "Pro" transfer behind a password — is refused.
 *   - A plain https address: taken as it is.
 */

const HOSTS = {
  dropbox: ["dropbox.com", "www.dropbox.com", "dl.dropboxusercontent.com"],
  drive: ["drive.google.com", "docs.google.com", "drive.usercontent.google.com"],
  wetransfer: ["wetransfer.com", "we.tl", "wetransfer.zendesk.com"],
};

function hostOf(url) {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Reads a link. Returns what to ask for, or why it cannot work here.
 *
 * @returns {{ kind: string, url?: string, flow?: string, id?: string, hash?: string, problem?: string }}
 */
export function classifyLink(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return { kind: "unusable", problem: `"${String(raw)}" is not a link` };
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return { kind: "unusable", problem: `${url.protocol}// is not a link this can download (https only)` };
  }
  const host = hostOf(url);

  if (HOSTS.dropbox.includes(host)) {
    if (url.pathname.startsWith("/home") || url.pathname.startsWith("/work")) {
      return { kind: "unusable", problem: "this is a Dropbox page inside an account, not a shared link. Ask for a share link ('Copy link')" };
    }
    const direct = new URL(url.href);
    direct.searchParams.set("dl", "1");
    return {
      kind: "dropbox",
      flow: "direct",
      url: direct.href,
      note: url.pathname.includes("/scl/fo/") || url.searchParams.has("preview") ? "a Dropbox folder link downloads a .zip of the folder" : null,
    };
  }

  if (HOSTS.drive.includes(host)) {
    if (url.pathname.startsWith("/drive/folders") || url.pathname.includes("/folders/")) {
      return {
        kind: "unusable",
        problem: "a Google Drive FOLDER cannot be downloaded without a login. Ask for one link per file, or a zip",
      };
    }
    const id = /\/file\/d\/([^/]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get("id");
    if (!id) return { kind: "unusable", problem: "this Google Drive link carries no file id" };
    return {
      kind: "drive",
      flow: "confirm",
      id,
      url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download`,
    };
  }

  if (HOSTS.wetransfer.includes(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "we.tl") {
      return {
        kind: "unusable",
        problem: "a we.tl short link opens a page in a browser. Ask for the full wetransfer.com/downloads/… link",
      };
    }
    if (parts[0] !== "downloads" || parts.length < 3) {
      return { kind: "unusable", problem: "not a WeTransfer download link (wetransfer.com/downloads/<id>/<hash>)" };
    }
    // .../downloads/<id>/<security hash> or .../downloads/<id>/<recipient>/<security hash>
    return { kind: "wetransfer", flow: "api", id: parts[1], hash: parts[parts.length - 1] };
  }

  return { kind: "https", flow: "direct", url: url.href };
}

/** What to POST to WeTransfer's API for a direct link, and where. */
export function wetransferRequest({ id, hash }) {
  return {
    url: `https://wetransfer.com/api/v4/transfers/${encodeURIComponent(id)}/download`,
    body: { intent: "entire_transfer", security_hash: hash },
  };
}

/**
 * Google Drive's "this file is too large for a virus scan" page carries the
 * address to ask for instead, as a form. Returns it, or null when the answer
 * was not that page.
 */
export function driveConfirmUrl(html, id) {
  const form = /<form[^>]+action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/i.exec(String(html));
  if (!form) return null;
  const action = form[1].replace(/&amp;/g, "&");
  const fields = new Map();
  for (const input of form[2].matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi)) {
    fields.set(input[1], input[2].replace(/&amp;/g, "&"));
  }
  if (!fields.has("id")) fields.set("id", id);
  if (!fields.has("export")) fields.set("export", "download");
  if (!fields.has("confirm")) fields.set("confirm", "t");
  const url = new URL(action);
  for (const [name, value] of fields) url.searchParams.set(name, value);
  return url.href;
}

/** The file name a server suggests, kept safe to write. */
export function filenameFromResponse({ disposition, url, fallback = "delivery.bin" }) {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(String(disposition ?? ""));
  const plain = /filename="?([^";]+)"?/i.exec(String(disposition ?? ""));
  let name = null;
  if (star) {
    try {
      name = decodeURIComponent(star[1]);
    } catch {
      name = star[1];
    }
  } else if (plain) {
    name = plain[1];
  } else if (url) {
    try {
      name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    } catch {
      name = null;
    }
  }
  const safe = String(name ?? "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return safe.length > 0 ? safe.slice(0, 120) : fallback;
}

/**
 * Is this answer a file, or a page asking a human to do something? A login
 * page downloaded as "the delivery" is the failure this prevents.
 */
export function looksLikeAFile({ status, contentType, contentLength }) {
  if (status !== 200 && status !== 206) {
    return { ok: false, problem: `the link answered ${status}: ask the studio for a new one` };
  }
  const type = String(contentType ?? "").toLowerCase();
  if (type.startsWith("text/html")) {
    return {
      ok: false,
      problem: "the link answered a web page, not a file: it probably needs a login, or it has expired. Ask for a link that anyone with the address can download",
    };
  }
  if (contentLength !== null && contentLength !== undefined && Number(contentLength) < 100_000) {
    return { ok: false, problem: `the link answered ${contentLength} bytes: that is not a video delivery` };
  }
  return { ok: true };
}
