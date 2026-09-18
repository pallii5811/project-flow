import { describe, expect, it } from "vitest";

import { LOCAL_SITE_URL, resolveSiteUrl, shareOrigin } from "./siteUrl";

describe("resolveSiteUrl", () => {
  it("falls back to localhost only when nothing is configured", () => {
    expect(resolveSiteUrl(undefined)).toBe(LOCAL_SITE_URL);
    expect(resolveSiteUrl("   ")).toBe(LOCAL_SITE_URL);
  });

  it("normalizes a configured origin", () => {
    expect(resolveSiteUrl("https://projectflow.example")).toBe(
      "https://projectflow.example",
    );
    expect(resolveSiteUrl(" https://projectflow.example/ ")).toBe(
      "https://projectflow.example",
    );
  });

  it.each([
    "projectflow.example",
    "ftp://projectflow.example",
    "https://projectflow.example/app",
    "https://projectflow.example/?ref=x",
  ])("fails the build on %s instead of publishing broken previews", (value) => {
    expect(() => resolveSiteUrl(value)).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });
});

describe("shareOrigin (VIR-8)", () => {
  it("builds every share on the configured site, whatever host served the page", () => {
    expect(shareOrigin("https://cliffies.example", "https://abc123.cliffies.pages.dev")).toBe(
      "https://cliffies.example",
    );
    expect(shareOrigin(" https://cliffies.example/ ", "http://localhost:3100")).toBe(
      "https://cliffies.example",
    );
  });

  it("falls back to the page's own origin only when no site was configured", () => {
    expect(shareOrigin(undefined, "http://localhost:3100")).toBe("http://localhost:3100");
    expect(shareOrigin("  ", "http://localhost:3100")).toBe("http://localhost:3100");
  });
});
