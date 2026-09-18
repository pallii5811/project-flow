import { describe, expect, it } from "vitest";

// The export side of the launch switch (robots.txt, _headers, sitemap).
import { isPublicLaunch as exportIsPublic } from "../../../../scripts/lib/platform.mjs";

import { BRAND_BACKGROUND, BRAND_NAME } from "./brand";
import {
  APP_ICONS,
  INSTALLED_START_URL,
  ROOT_VIEWPORT,
  episodePageTitle,
  episodeShareTitle,
  isPublicLaunch,
  rootMetadata,
  shareMessage,
  watchMetadata,
  webAppManifest,
} from "./siteMetadata";

const episode = (episodeNumber: number, episodeTitle = "The Call") => ({
  seriesTitle: "Signal Night",
  episodeNumber,
  episodeTitle,
  hook: "She answers.\nNobody is there.",
  shareCardUrl: `/content/series/signal-night/share/episode-${episodeNumber}.jpg`,
});

describe("the closed-beta switch", () => {
  it.each([undefined, "", "0", "true", "yes", "01", "1x"])("keeps the site closed for %j", (raw) => {
    expect(isPublicLaunch(raw)).toBe(false);
    expect(exportIsPublic(raw)).toBe(false);
  });

  it.each(["1", " 1 "])("opens it only for %j, on both sides", (raw) => {
    expect(isPublicLaunch(raw)).toBe(true);
    expect(exportIsPublic(raw)).toBe(true);
  });

  it("puts noindex on every page while closed", () => {
    expect(rootMetadata("https://cliffies.example", false).robots).toEqual({
      index: false,
      follow: false,
    });
    expect(rootMetadata("https://cliffies.example", true).robots).toEqual({
      index: true,
      follow: true,
    });
  });
});

describe("an episode page describes itself (VIR-5)", () => {
  it("has its own title and share title", () => {
    expect(episodePageTitle(episode(3))).toBe("Signal Night · Episode 3");
    expect(episodeShareTitle(episode(3))).toBe("Signal Night · Ep. 3: The Call");
    // An episode title that only repeats the series is dropped.
    expect(episodeShareTitle(episode(3, "Signal Night"))).toBe("Signal Night · Ep. 3");
    expect(episodeShareTitle(episode(3, "  "))).toBe("Signal Night · Ep. 3");
  });

  it("gives every episode of a series a different title", () => {
    const titles = Array.from({ length: 40 }, (_, index) => episodePageTitle(episode(index + 1)));
    expect(new Set(titles).size).toBe(40);
  });

  it("repeats og:type and og:site_name, which a page-level openGraph would otherwise drop", () => {
    const metadata = watchMetadata(episode(3), "/watch/signal-night/episode-3");
    expect(metadata.title).toBe("Signal Night · Episode 3");
    expect(metadata.alternates?.canonical).toBe("/watch/signal-night/episode-3");
    expect(metadata.openGraph).toMatchObject({
      type: "video.episode",
      siteName: BRAND_NAME,
      title: "Signal Night · Ep. 3: The Call",
      url: "/watch/signal-night/episode-3",
      description: "She answers. Nobody is there.",
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("says what a shared link is, and names the product once", () => {
    expect(shareMessage(episode(3))).toEqual({
      title: "Signal Night · Episode 3",
      text: `She answers. Nobody is there. — Signal Night, episode 3, on ${BRAND_NAME}`,
    });
    expect(shareMessage({ ...episode(2), hook: "" }).text).toBe(
      `Signal Night, episode 2, on ${BRAND_NAME}`,
    );
  });
});

describe("installable (A11Y-04)", () => {
  it("is a standalone portrait app that starts on the feed, counted as a home-screen launch", () => {
    const manifest = webAppManifest();
    expect(manifest).toMatchObject({
      name: BRAND_NAME,
      short_name: BRAND_NAME,
      display: "standalone",
      orientation: "portrait",
      scope: "/",
      background_color: BRAND_BACKGROUND,
      theme_color: BRAND_BACKGROUND,
    });
    expect(manifest.start_url).toBe(INSTALLED_START_URL);
    expect(new URL(INSTALLED_START_URL, "https://x.example").pathname).toBe("/");
    expect(new URL(INSTALLED_START_URL, "https://x.example").searchParams.get("utm_source")).toBe(
      "homescreen",
    );
  });

  it("declares 192, 512 and a maskable 512", () => {
    expect(APP_ICONS.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual([
      "192x192 any",
      "512x512 any",
      "512x512 maskable",
    ]);
  });

  it("runs edge to edge with dark bars", () => {
    expect(ROOT_VIEWPORT).toMatchObject({
      viewportFit: "cover",
      themeColor: BRAND_BACKGROUND,
      colorScheme: "dark",
    });
    expect(rootMetadata("https://cliffies.example", false).appleWebApp).toMatchObject({
      capable: true,
      statusBarStyle: "black-translucent",
    });
  });
});
