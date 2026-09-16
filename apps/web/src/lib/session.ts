const ANON_KEY = "project-flow.anonymous_user.v1";
const SESSION_KEY = "project-flow.session.v1";
const ACQUISITION_KEY = "project-flow.acquisition.v1";

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode / quota
  }
}

function readSessionStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

/**
 * Durable anonymous product identity — survives refresh and new sessions.
 */
export function getOrCreateAnonymousUserId(): string {
  if (typeof window === "undefined") return "ssr_anonymous";
  const existing = readStorage(ANON_KEY);
  if (existing && existing.length > 0) return existing;
  const next = createId("anon");
  writeStorage(ANON_KEY, next);
  return next;
}

/**
 * Short-lived usage context for a browsing session.
 */
export function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "ssr_session";
  try {
    const fromSession = window.sessionStorage.getItem(SESSION_KEY);
    if (fromSession && fromSession.length > 0) return fromSession;
    const next = createId("session");
    window.sessionStorage.setItem(SESSION_KEY, next);
    writeStorage(`${SESSION_KEY}.last`, next);
    return next;
  } catch {
    const existing = readStorage(`${SESSION_KEY}.last`);
    if (existing) return existing;
    return createId("session");
  }
}

export type AcquisitionParams = {
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  shareId: string | null;
};

export function parseAcquisitionSearch(search: string): Omit<AcquisitionParams, "referrer"> {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return {
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    shareId: params.get("share_id"),
  };
}

export function readAcquisitionParams(
  search: string = typeof window !== "undefined" ? window.location.search : "",
  referrer: string = typeof document !== "undefined" ? document.referrer : "",
): AcquisitionParams {
  const parsed = parseAcquisitionSearch(search);
  return {
    referrer: referrer || null,
    ...parsed,
  };
}

/** Persist acquisition into the anonymous session (first non-empty wins per field merge). */
export function persistAcquisitionContext(params: AcquisitionParams): AcquisitionParams {
  const existing = loadAcquisitionContext();
  const merged: AcquisitionParams = {
    referrer: params.referrer || existing?.referrer || null,
    utmSource: params.utmSource || existing?.utmSource || null,
    utmMedium: params.utmMedium || existing?.utmMedium || null,
    utmCampaign: params.utmCampaign || existing?.utmCampaign || null,
    shareId: params.shareId || existing?.shareId || null,
  };
  try {
    writeSessionStorage(ACQUISITION_KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }
  return merged;
}

export function loadAcquisitionContext(): AcquisitionParams | null {
  const raw = readSessionStorage(ACQUISITION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AcquisitionParams>;
    return {
      referrer: parsed.referrer ?? null,
      utmSource: parsed.utmSource ?? null,
      utmMedium: parsed.utmMedium ?? null,
      utmCampaign: parsed.utmCampaign ?? null,
      shareId: parsed.shareId ?? null,
    };
  } catch {
    return null;
  }
}

/** Capture URL params into session; returns effective acquisition for analytics context. */
export function captureAcquisitionFromLocation(): AcquisitionParams {
  const fromUrl = readAcquisitionParams();
  const hasAttribution =
    Boolean(fromUrl.utmSource) ||
    Boolean(fromUrl.utmMedium) ||
    Boolean(fromUrl.utmCampaign) ||
    Boolean(fromUrl.shareId) ||
    Boolean(fromUrl.referrer);
  if (hasAttribution) {
    return persistAcquisitionContext(fromUrl);
  }
  return loadAcquisitionContext() ?? fromUrl;
}

export function createShareId(): string {
  return createId("share");
}

export function viewportClass(width: number): string {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

export function isDiagEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV === "production") {
    return process.env.NEXT_PUBLIC_ENABLE_DIAG === "1";
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("diag") === "1") return true;
    if (window.localStorage.getItem("project-flow.diag") === "1") return true;
  } catch {
    return false;
  }
  return false;
}

export function enableDiagFlag(): void {
  writeStorage("project-flow.diag", "1");
}
