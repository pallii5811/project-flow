/**
 * Absolute origin for share previews (og:image, og:url, canonical).
 *
 * Link crawlers (WhatsApp, Telegram, X, Facebook) ignore relative URLs, so a
 * wrong origin breaks every shared link without any visible error. Local
 * builds fall back to localhost; deploy builds must set NEXT_PUBLIC_SITE_URL,
 * and scripts/deploy-checks.mjs refuses to publish an export without it.
 */
export const LOCAL_SITE_URL = "http://localhost:3000";

export function resolveSiteUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return LOCAL_SITE_URL;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`NEXT_PUBLIC_SITE_URL is not a valid URL: "${value}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`NEXT_PUBLIC_SITE_URL must be http(s): "${value}"`);
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error(`NEXT_PUBLIC_SITE_URL must be an origin without path: "${value}"`);
  }
  return url.origin;
}
