/**
 * What a studio's link is (scripts/lib/delivery-links.mjs). The rule behind
 * every case: a machine nobody is sitting at cannot log in, so a link that
 * needs a login must be refused in one line — never downloaded as a login
 * page and treated as a delivery.
 */
import { describe, expect, it } from "vitest";

import {
  classifyLink,
  driveConfirmUrl,
  filenameFromResponse,
  looksLikeAFile,
  wetransferRequest,
} from "../scripts/lib/delivery-links.mjs";

describe("reading a link", () => {
  it("Dropbox: a share link is asked for with dl=1; a folder link gives a zip", () => {
    const file = classifyLink("https://www.dropbox.com/scl/fi/abc/EP01.mp4?rlkey=xyz&dl=0");
    expect(file.kind).toBe("dropbox");
    expect(file.url).toContain("dl=1");
    expect(file.url).not.toContain("dl=0");
    expect(classifyLink("https://www.dropbox.com/scl/fo/abc/folder?rlkey=xyz&dl=0").note).toMatch(/zip/);
  });

  it("Dropbox: a page inside someone's account is refused", () => {
    const inside = classifyLink("https://www.dropbox.com/home/Deliveries");
    expect(inside.kind).toBe("unusable");
    expect(inside.problem).toMatch(/share link/);
  });

  it("Google Drive: a file link becomes a download address; a folder is refused", () => {
    const file = classifyLink("https://drive.google.com/file/d/1A2B3C/view?usp=sharing");
    expect(file).toMatchObject({ kind: "drive", id: "1A2B3C" });
    expect(file.url).toContain("drive.usercontent.google.com/download?id=1A2B3C");
    expect(classifyLink("https://drive.google.com/uc?export=download&id=9Z8Y").id).toBe("9Z8Y");
    expect(classifyLink("https://drive.google.com/drive/folders/1A2B3C").problem).toMatch(/FOLDER/);
  });

  it("WeTransfer: the download page's id and hash, not the page", () => {
    expect(classifyLink("https://wetransfer.com/downloads/abc123/def456")).toMatchObject({
      kind: "wetransfer",
      id: "abc123",
      hash: "def456",
    });
    // …/downloads/<id>/<recipient>/<hash>
    expect(classifyLink("https://wetransfer.com/downloads/abc123/someone@studio.cn/def456").hash).toBe("def456");
    expect(classifyLink("https://we.tl/t-abcdef").kind).toBe("unusable");
    expect(wetransferRequest({ id: "abc123", hash: "def456" })).toEqual({
      url: "https://wetransfer.com/api/v4/transfers/abc123/download",
      body: { intent: "entire_transfer", security_hash: "def456" },
    });
  });

  it("a plain https address is taken as it is; anything else is refused", () => {
    expect(classifyLink("https://cdn.studio.cn/deliveries/night-shift.mp4")).toMatchObject({ kind: "https" });
    expect(classifyLink("ftp://studio.cn/file.mp4").kind).toBe("unusable");
    expect(classifyLink("not a link").kind).toBe("unusable");
    // Proofs serve the delivery from this machine.
    expect(classifyLink("http://127.0.0.1:3218/the-series.mp4").kind).toBe("https");
    expect(classifyLink("http://studio.cn/file.mp4").kind).toBe("unusable");
  });
});

describe("Google Drive's confirmation page", () => {
  it("is read for the address it says to ask for instead", () => {
    const html = `<!DOCTYPE html><html><body><form id="download-form" action="https://drive.usercontent.google.com/download?id=1A2B3C&amp;export=download&amp;authuser=0">
      <input type="hidden" name="id" value="1A2B3C"><input type="hidden" name="export" value="download">
      <input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="9f0e-1234">
      </form></body></html>`;
    const url = driveConfirmUrl(html, "1A2B3C");
    expect(url).toContain("confirm=t");
    expect(url).toContain("uuid=9f0e-1234");
    expect(url).toContain("id=1A2B3C");
    expect(driveConfirmUrl("<html><body>Sign in</body></html>", "1A2B3C")).toBeNull();
  });
});

describe("what came back", () => {
  it("a web page is not a delivery, and neither is a handful of bytes", () => {
    expect(looksLikeAFile({ status: 200, contentType: "video/mp4", contentLength: 4_000_000 }).ok).toBe(true);
    expect(looksLikeAFile({ status: 200, contentType: "text/html; charset=utf-8", contentLength: 4_000 }).problem).toMatch(
      /needs a login/,
    );
    expect(looksLikeAFile({ status: 404, contentType: "video/mp4", contentLength: 1 }).problem).toMatch(/404/);
    expect(looksLikeAFile({ status: 200, contentType: "video/mp4", contentLength: 900 }).ok).toBe(false);
    // A server that says nothing about the size is not refused for that.
    expect(looksLikeAFile({ status: 200, contentType: "video/mp4", contentLength: null }).ok).toBe(true);
  });

  it("the file name is the server's, made safe", () => {
    expect(filenameFromResponse({ disposition: 'attachment; filename="NIGHT SHIFT ep1.mp4"' })).toBe("NIGHT SHIFT ep1.mp4");
    expect(filenameFromResponse({ disposition: "attachment; filename*=UTF-8''%E5%A4%9C%E7%8F%AD.mp4" })).toBe("夜班.mp4");
    // A name that tries to climb out of the folder cannot: no slash survives,
    // and it cannot start with a dot either.
    expect(filenameFromResponse({ disposition: 'attachment; filename="../../etc/passwd"' })).toBe("_.._etc_passwd");
    expect(filenameFromResponse({ disposition: null, url: "https://cdn.studio.cn/a/b/night-shift.mp4" })).toBe("night-shift.mp4");
    expect(filenameFromResponse({ disposition: null, url: "https://cdn.studio.cn/", fallback: "delivery-1.mp4" })).toBe(
      "delivery-1.mp4",
    );
  });
});
