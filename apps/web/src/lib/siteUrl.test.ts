import { describe, expect, it } from "vitest";

import { LOCAL_SITE_URL, resolveSiteUrl } from "./siteUrl";

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
