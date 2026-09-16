/**
 * Adaptive streaming decisions, kept pure so they can be tested without a
 * browser. The adapter only executes what these functions decide.
 */

const HLS_MIME_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
]);

export function isHlsSource(mimeType: string, uri: string): boolean {
  if (HLS_MIME_TYPES.has(mimeType.trim().toLowerCase())) return true;
  const path = uri.split(/[?#]/)[0] ?? "";
  return path.toLowerCase().endsWith(".m3u8");
}

export type HlsEngine = "native" | "hlsjs" | "unsupported";

export type HlsEnvironment = {
  /** video.canPlayType("application/vnd.apple.mpegurl") is not "". */
  canPlayNativeHls: boolean;
  /** hls.js reports Media Source Extensions (or Managed Media Source) support. */
  mediaSourceSupported: boolean;
  isSafari: boolean;
};

/**
 * Safari plays HLS natively with better battery life and AirPlay, so it keeps
 * its own engine. Everywhere else hls.js runs, because only hls.js lets us
 * cap how much of a not-yet-watched episode is downloaded.
 */
export function chooseHlsEngine(env: HlsEnvironment): HlsEngine {
  if (env.canPlayNativeHls && (env.isSafari || !env.mediaSourceSupported))
    return "native";
  if (env.mediaSourceSupported) return "hlsjs";
  if (env.canPlayNativeHls) return "native";
  return "unsupported";
}

/** Safari, and not one of the browsers that put "Safari" in their user agent. */
export const SAFARI_USER_AGENT_PATTERN =
  /^((?!chrome|chromium|android|crios|fxios|edg|opr).)*safari/i;

export function isSafariUserAgent(userAgent: string): boolean {
  return SAFARI_USER_AGENT_PATTERN.test(userAgent);
}

/**
 * Whether to start downloading hls.js before any player asks for it (speed-4).
 * Only where hls.js will run: Safari plays HLS natively and must not pay for
 * an engine it never uses.
 */
export function shouldWarmHlsEngine(env: {
  isSafari: boolean;
  mediaSourceSupported: boolean;
}): boolean {
  return env.mediaSourceSupported && !env.isSafari;
}

/**
 * Stands for the hls.js chunk URL in the warmup script. The chunk name is only
 * known after `next build`; scripts/link-hls-engine.mjs replaces this token in
 * the exported pages. Left in place (next dev), the script skips the engine.
 */
export const HLS_ENGINE_CHUNK_PLACEHOLDER = "__FLOW_HLS_ENGINE_CHUNK__";

/**
 * Inline script for the static HTML (speed-4). Where hls.js will play the
 * episode, it starts downloading the hls.js chunk and the episode's playlist
 * while the page's JavaScript is still downloading, instead of after
 * hydration. Safari (native HLS) and browsers without Media Source skip it and
 * fetch nothing extra.
 */
export function buildHlsWarmupScript(playlists: string[]): string {
  // "<" escaped so no URL can close the script element.
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  return [
    "(function(){try{",
    `if(new RegExp(${json(SAFARI_USER_AGENT_PATTERN.source)},"i").test(navigator.userAgent))return;`,
    "if(!(window.MediaSource||window.ManagedMediaSource))return;",
    "var add=function(as,href,cors){var l=document.createElement('link');",
    "l.rel='preload';l.as=as;if(cors)l.crossOrigin='anonymous';l.href=href;document.head.appendChild(l);};",
    `var engine=${json(HLS_ENGINE_CHUNK_PLACEHOLDER)};`,
    "if(engine.indexOf('__')!==0)add('script',engine,false);",
    `var urls=${json(playlists)};`,
    "for(var i=0;i<urls.length;i++)add('fetch',urls[i],true);",
    "}catch(e){}})();",
  ].join("");
}

export type HlsLoadPlan = {
  /** manifest = playlists only; segments = also media bytes. */
  load: "manifest" | "segments";
  /**
   * hls.js maxBufferLength. Careful: hls.js treats it as a FLOOR — the real
   * ceiling is maxMaxBufferLength (measured 2026-09-16: with only this set to
   * 4 s, a 10 s next episode was downloaded whole).
   */
  targetBufferSeconds: number;
  /** hls.js maxMaxBufferLength: the hard ceiling of media ahead of the playhead. */
  maxBufferSeconds: number;
};

/** Seconds of the next episode warmed while the current one plays. */
export const NEXT_EPISODE_WARM_SECONDS = 4;
export const ACTIVE_BUFFER_SECONDS = 30;
export const ACTIVE_MAX_BUFFER_SECONDS = 60;

/**
 * Spec: preload current fully warm + next intelligently, never an arbitrary
 * queue. The next episode gets only its first seconds — enough for an instant
 * swipe, not a whole episode the viewer may never watch.
 */
export function planHlsLoad(
  active: boolean,
  preload: "none" | "metadata" | "auto",
): HlsLoadPlan {
  if (active) {
    return {
      load: "segments",
      targetBufferSeconds: ACTIVE_BUFFER_SECONDS,
      maxBufferSeconds: ACTIVE_MAX_BUFFER_SECONDS,
    };
  }
  return {
    load: preload === "auto" ? "segments" : "manifest",
    targetBufferSeconds: NEXT_EPISODE_WARM_SECONDS,
    maxBufferSeconds: NEXT_EPISODE_WARM_SECONDS,
  };
}

export type NetworkHints = {
  /** navigator.connection.downlink, megabits per second. */
  downlinkMbps?: number | undefined;
  /** navigator.connection.saveData. */
  saveData?: boolean | undefined;
};

export type StartQuality = {
  /** First bandwidth guess for adaptive bitrate, bits per second. */
  estimateBps: number;
  /** The viewer asked to save data: stay on the lightest rendition. */
  capToLowest: boolean;
};

/** Without a hint, start around 1 Mbps: sharp enough, and fast on 4G. */
export const DEFAULT_START_ESTIMATE_BPS = 1_000_000;

export function startQuality(hints: NetworkHints): StartQuality {
  const capToLowest = hints.saveData === true;
  const downlink = hints.downlinkMbps;
  if (typeof downlink !== "number" || !Number.isFinite(downlink) || downlink <= 0) {
    return { estimateBps: DEFAULT_START_ESTIMATE_BPS, capToLowest };
  }
  // Browsers round and cap downlink; keep 20% headroom and sane bounds.
  const estimateBps = Math.min(
    10_000_000,
    Math.max(300_000, Math.round(downlink * 800_000)),
  );
  return { estimateBps, capToLowest };
}
