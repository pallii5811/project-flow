/**
 * The product's public name, in one place.
 *
 * The owner may still rename the product: changing BRAND_NAME is the whole
 * edit. Page titles, og:site_name, the web app manifest, the 404 and offline
 * pages, the install invitation and share texts all read it from here, and
 * `brand.test.ts` proves it by swapping the name and looking at every one of
 * them. Package names and storage keys ("project-flow.*") are internal and do
 * not change with it.
 *
 * The app icon carries no letters on purpose, so a new name needs no new icon.
 */
export const BRAND_NAME = "Cliffies";

/** The one-line promise under the name: search results and the manifest. */
export const BRAND_TAGLINE = "Short drama that starts the moment you open it.";

/**
 * The stage colour: the page, the browser bars around it, the splash of the
 * installed app. Same as darkColors.background in the design system.
 */
export const BRAND_BACKGROUND = "#0b0b0c";
