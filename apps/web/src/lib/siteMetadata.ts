/**
 * Everything the product says about itself outside the picture: page titles,
 * link previews, the web app manifest, the texts a share carries. Pure, so a
 * test can swap the brand and prove every place follows it (brand.test.ts).
 */
import type { Metadata, MetadataRoute, Viewport } from "next";

import { BRAND_BACKGROUND, BRAND_NAME, BRAND_TAGLINE } from "./brand";

/**
 * The closed-beta switch (docs/deploy.md). Only the exact value "1" opens the
 * site to search engines: anything else, a typo included, keeps it closed.
 * scripts/lib/platform.mjs reads the same variable with the same rule for
 * robots.txt, sitemap.xml and X-Robots-Tag, and scripts/deploy-checks.mjs
 * refuses an export where the two disagree.
 */
export function isPublicLaunch(raw: string | undefined): boolean {
  return raw?.trim() === "1";
}

/** Where a launch from the home screen lands, marked so it can be counted. */
export const INSTALLED_START_URL = "/?utm_source=homescreen&utm_medium=installed_app";

/** Icons written by scripts/make-icons.mjs from apps/web/brand/mark.svg. */
export const APP_ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  {
    src: "/icons/maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
] as const;

export function rootMetadata(siteUrl: string, indexable: boolean): Metadata {
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: BRAND_NAME,
      template: `%s · ${BRAND_NAME}`,
    },
    description: BRAND_TAGLINE,
    applicationName: BRAND_NAME,
    appleWebApp: {
      capable: true,
      title: BRAND_NAME,
      // The picture runs under the status bar, as it does in the browser with
      // viewport-fit=cover; the chrome already clears the inset (A11Y-05).
      statusBarStyle: "black-translucent",
    },
    formatDetection: { telephone: false },
    openGraph: {
      type: "website",
      siteName: BRAND_NAME,
    },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export const ROOT_VIEWPORT: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Edge to edge: without it every env(safe-area-inset-*) is 0 on a phone
  // and Safari letterboxes the page (A11Y-04).
  viewportFit: "cover",
  themeColor: BRAND_BACKGROUND,
  colorScheme: "dark",
};

export function webAppManifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: BRAND_TAGLINE,
    start_url: INSTALLED_START_URL,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: BRAND_BACKGROUND,
    theme_color: BRAND_BACKGROUND,
    categories: ["entertainment"],
    icons: APP_ICONS.map((icon) => ({ ...icon })),
  };
}

/** What a page for one episode needs to describe itself. */
export type EpisodeCopy = {
  seriesTitle: string;
  episodeNumber: number;
  /** The episode's own title; dropped when it only repeats the series. */
  episodeTitle: string;
  hook: string;
  shareCardUrl: string;
};

/** The size scripts/ingest-series.mjs writes; declared so crawlers can lay it out. */
export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

/** "Signal Night · Episode 3": the tab, the search result, the history entry. */
export function episodePageTitle(copy: Pick<EpisodeCopy, "seriesTitle" | "episodeNumber">): string {
  return `${copy.seriesTitle} · Episode ${copy.episodeNumber}`;
}

/** "Signal Night · Ep. 3: The Call": the bold line of a link preview (VIR-5). */
export function episodeShareTitle(copy: EpisodeCopy): string {
  const base = `${copy.seriesTitle} · Ep. ${copy.episodeNumber}`;
  const own = copy.episodeTitle.trim();
  return own && own !== copy.seriesTitle ? `${base}: ${own}` : base;
}

export function watchMetadata(copy: EpisodeCopy, path: string): Metadata {
  const description = copy.hook.replace(/\s*\n\s*/g, " ");
  const shareTitle = episodeShareTitle(copy);
  return {
    title: episodePageTitle(copy),
    description,
    alternates: { canonical: path },
    openGraph: {
      // A page-level openGraph replaces the layout's whole object, so the
      // type and the site name are repeated here (VIR-5).
      type: "video.episode",
      siteName: BRAND_NAME,
      title: shareTitle,
      description,
      url: path,
      // VIR-4: crawlers crop a wide card to about 1.91:1; the 9:16 poster
      // would be cut to a thin band, so the card is the landscape image
      // ingest builds from the same frame.
      images: [
        {
          url: copy.shareCardUrl,
          width: SHARE_CARD_WIDTH,
          height: SHARE_CARD_HEIGHT,
          alt: `${copy.seriesTitle}, episode ${copy.episodeNumber}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description,
      images: [copy.shareCardUrl],
    },
  };
}

/** What a page about a whole series needs to describe itself. */
export type SeriesCopy = {
  title: string;
  hook: string;
  episodeCount: number;
  shareCardUrl: string;
};

/**
 * The page a clip sends a stranger to, and the one search engines will index
 * once the beta opens. `openGraph` at page level replaces the layout's whole
 * object, so the type and the site name are repeated here (VIR-5).
 */
export function seriesMetadata(copy: SeriesCopy, path: string): Metadata {
  const description = `${copy.hook.replace(/\s*\n\s*/g, " ")} ${
    copy.episodeCount === 1 ? "1 episode" : `${copy.episodeCount} episodes`
  }, free forever.`.trim();
  return {
    title: copy.title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: BRAND_NAME,
      title: `${copy.title} · ${BRAND_NAME}`,
      description,
      url: path,
      images: [
        {
          url: copy.shareCardUrl,
          width: SHARE_CARD_WIDTH,
          height: SHARE_CARD_HEIGHT,
          alt: copy.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${copy.title} · ${BRAND_NAME}`,
      description,
      images: [copy.shareCardUrl],
    },
  };
}

/**
 * A page of the site that is not an episode and not a series: the list of
 * what exists, the page for studios. No link-preview picture is claimed,
 * because none is generated for them.
 */
export function plainPageMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: BRAND_NAME,
      title: `${title} · ${BRAND_NAME}`,
      description,
      url: path,
    },
  };
}

/**
 * The words that travel with a shared link. Messaging apps show the text and
 * the preview card; the product's name is said once, at the end.
 */
export function shareMessage(copy: Pick<EpisodeCopy, "seriesTitle" | "episodeNumber" | "hook">): {
  title: string;
  text: string;
} {
  const hook = copy.hook.replace(/\s*\n\s*/g, " ").trim();
  const where = `${copy.seriesTitle}, episode ${copy.episodeNumber}, on ${BRAND_NAME}`;
  return {
    title: episodePageTitle(copy),
    text: hook ? `${hook} — ${where}` : where,
  };
}
