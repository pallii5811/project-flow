import type { LocalizedMetadata, LocalizedStrings } from "../model/types";

/**
 * Resolve localized copy:
 * requested locale → base language (e.g. pt from pt-BR) → defaultLocale → first available.
 */
export function resolveLocalizedStrings(
  localized: LocalizedMetadata,
  requestedLocale: string | null | undefined,
  defaultLocale: string,
): LocalizedStrings | null {
  if (requestedLocale && localized[requestedLocale]) {
    return localized[requestedLocale] ?? null;
  }
  if (requestedLocale) {
    const base = requestedLocale.split("-")[0];
    if (base && localized[base]) return localized[base] ?? null;
  }
  if (localized[defaultLocale]) return localized[defaultLocale] ?? null;
  const first = Object.values(localized)[0];
  return first ?? null;
}

export function resolveDisplayCopy(
  item: {
    title: string;
    hook: string;
    defaultLocale: string;
    localizedMetadata: LocalizedMetadata;
  },
  locale?: string | null,
): { title: string; hook: string; description?: string } {
  const resolved = resolveLocalizedStrings(
    item.localizedMetadata,
    locale,
    item.defaultLocale,
  );
  if (!resolved) {
    return { title: item.title, hook: item.hook };
  }
  return {
    title: resolved.title,
    hook: resolved.hook,
    ...(resolved.description ? { description: resolved.description } : {}),
  };
}
