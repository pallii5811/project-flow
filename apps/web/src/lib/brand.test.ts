/**
 * The product's name lives in ONE constant (brand.ts). The owner may still
 * change it, so this file proves two things:
 *
 * 1. swapping BRAND_NAME alone reaches every visible place — page titles,
 *    og:site_name, the web app manifest, the 404 and offline pages, the
 *    install invitation and the text a share carries;
 * 2. no other file under apps/web/src spells the name, so there is nothing
 *    else to edit.
 *
 * scripts/deploy-checks.mjs and scripts/e2e-platform.mjs read the name from
 * brand.ts too, and refuse an export where a page says otherwise.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BRAND_NAME } from "./brand";

const SWAPPED = "Zephyrine";
const webSrc = resolve(__dirname, "..");

async function withBrand(name: string) {
  vi.resetModules();
  vi.doMock("./brand", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./brand")>()),
    BRAND_NAME: name,
  }));
  const metadata = await import("./siteMetadata");
  const { BrandMark } = await import("../features/platform/BrandMark");
  const { InstallOffer } = await import("../features/platform/InstallOffer");
  return { metadata, BrandMark, InstallOffer };
}

afterEach(() => {
  vi.doUnmock("./brand");
  vi.resetModules();
});

describe("the brand constant", () => {
  it("is a plain name, readable by the scripts that check the export", () => {
    const source = readFileSync(join(__dirname, "brand.ts"), "utf8");
    // deploy-checks.mjs and e2e-platform.mjs read it with this exact shape.
    expect(/export const BRAND_NAME = "([^"]+)";/.exec(source)?.[1]).toBe(BRAND_NAME);
    expect(BRAND_NAME.trim()).toBe(BRAND_NAME);
    expect(BRAND_NAME.length).toBeGreaterThan(0);
  });

  it("reaches every visible place when it alone changes", async () => {
    const { metadata, BrandMark, InstallOffer } = await withBrand(SWAPPED);

    const root = metadata.rootMetadata("https://cliffies.example", false);
    expect(root.title).toEqual({ default: SWAPPED, template: `%s · ${SWAPPED}` });
    expect(root.applicationName).toBe(SWAPPED);
    expect(root.appleWebApp).toMatchObject({ title: SWAPPED });
    expect(root.openGraph).toMatchObject({ siteName: SWAPPED });

    const manifest = metadata.webAppManifest();
    expect(manifest.name).toBe(SWAPPED);
    expect(manifest.short_name).toBe(SWAPPED);

    const copy = {
      seriesTitle: "Signal Night",
      episodeNumber: 3,
      episodeTitle: "The Call",
      hook: "She answers.\nNobody is there.",
      shareCardUrl: "/content/series/signal-night/share/episode-3.jpg",
    };
    const watch = metadata.watchMetadata(copy, "/watch/signal-night/episode-3");
    expect(watch.openGraph).toMatchObject({ siteName: SWAPPED });
    expect(metadata.shareMessage(copy).text).toContain(`on ${SWAPPED}`);

    // The 404 and the offline page draw the name through BrandMark.
    const mark = renderToStaticMarkup(createElement(BrandMark));
    expect(mark).toContain(SWAPPED);

    for (const platform of ["prompt", "ios"] as const) {
      const card = renderToStaticMarkup(
        createElement(InstallOffer, { platform, onAccept: () => {}, onDismiss: () => {} }),
      );
      expect(card).toContain(SWAPPED);
      expect(card).not.toContain(BRAND_NAME);
    }

    // Nothing above still says the real name.
    const everything = JSON.stringify({ root, manifest, watch, share: metadata.shareMessage(copy) });
    expect(everything).not.toContain(BRAND_NAME);
  });

  it("is spelled nowhere else in the web app", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(tsx?|css|js|json)$/.test(name) || name.endsWith(".test.ts")) continue;
        if (path === join(__dirname, "brand.ts")) continue;
        const text = readFileSync(path, "utf8");
        if (text.includes(BRAND_NAME) || /PROJECT FLOW|Project Flow/.test(text)) {
          offenders.push(relative(webSrc, path));
        }
      }
    };
    walk(webSrc);
    walk(resolve(webSrc, "../public"));
    expect(offenders).toEqual([]);
  });
});
