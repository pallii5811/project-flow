/**
 * Every app icon, drawn from one source: apps/web/brand/mark.svg.
 *
 *   node scripts/make-icons.mjs
 *
 * Renders with the system Chrome through playwright-core (already the e2e
 * driver: no new dependency, no image library) and writes:
 *
 *   apps/web/public/icons/icon-192.png      manifest, purpose "any"
 *   apps/web/public/icons/icon-512.png      manifest, purpose "any"
 *   apps/web/public/icons/maskable-512.png  manifest, purpose "maskable" (mark inside the safe zone)
 *   apps/web/src/app/apple-icon.png         180x180, Add to Home Screen on iOS
 *   apps/web/src/app/icon.svg               the browser tab, any size
 *   apps/web/src/app/favicon.ico            16, 32 and 48 px, older browsers
 *
 * The outputs are committed: the build never runs Chrome. Run this again only
 * when the mark changes, then look at the result at 48 px and below.
 */
import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const web = resolve(repoRoot, "apps/web");
const source = readFileSync(resolve(web, "brand/mark.svg"), "utf8");

/** The mark without its own svg element, so it can be placed on a tile. */
const markBody = source
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .trim();

/**
 * A tile under the mark. `radius` 0 is full bleed (the platform masks it:
 * Android's launcher shape, iOS's rounded square); a radius draws the
 * rounded square itself, for the browser tab.
 */
function tileSvg({ size, radius, scale }) {
  const transform = `translate(256 256) scale(${scale}) translate(-256 -256)`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">`,
    "<defs>",
    '<radialGradient id="tile" cx="50%" cy="24%" r="86%">',
    '<stop offset="0" stop-color="#232226" />',
    '<stop offset="0.62" stop-color="#121214" />',
    '<stop offset="1" stop-color="#0B0B0C" />',
    "</radialGradient>",
    "</defs>",
    `<rect width="512" height="512" rx="${radius}" fill="url(#tile)" />`,
    `<g transform="${transform}">${markBody}</g>`,
    "</svg>",
  ].join("");
}

/** Full-bleed tiles: the mark a little larger than the maskable safe zone allows. */
const FULL_BLEED_SCALE = 1.12;
/** Maskable: the mark (radius 186) stays inside the 204 px safe circle. */
const MASKABLE_SCALE = 1.0;
/** The browser tab: a rounded square, the mark as large as it can read. */
const TAB = { radius: 112, scale: 1.34 };

const outputs = [
  { path: "public/icons/icon-192.png", size: 192, radius: 0, scale: FULL_BLEED_SCALE },
  { path: "public/icons/icon-512.png", size: 512, radius: 0, scale: FULL_BLEED_SCALE },
  { path: "public/icons/maskable-512.png", size: 512, radius: 0, scale: MASKABLE_SCALE },
  { path: "src/app/apple-icon.png", size: 180, radius: 0, scale: FULL_BLEED_SCALE },
];
const FAVICON_SIZES = [16, 32, 48];

/** An .ico holding PNG images, which every browser since IE Vista reads. */
function icoFromPngs(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((png) => png.data)]);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (svg, size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
    );
    return page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
  };

  for (const output of outputs) {
    const png = await render(tileSvg(output), output.size);
    const target = resolve(web, output.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, png);
    console.error(`make-icons: ${output.path} (${output.size}px, ${png.length} B)`);
  }

  const favicons = [];
  for (const size of FAVICON_SIZES) {
    favicons.push({ size, data: await render(tileSvg({ size, ...TAB }), size) });
  }
  writeFileSync(resolve(web, "src/app/favicon.ico"), icoFromPngs(favicons));
  console.error(`make-icons: src/app/favicon.ico (${FAVICON_SIZES.join(", ")} px)`);

  // The tab icon stays a vector: sharp at any density.
  writeFileSync(resolve(web, "src/app/icon.svg"), `${tileSvg({ size: 512, ...TAB })}\n`);
  console.error("make-icons: src/app/icon.svg");
} finally {
  await browser.close();
}
