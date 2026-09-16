import type { PlaybackDescriptor } from "../model/types";

export type PlaybackErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "EXPIRED"
  | "UNSUPPORTED_MIME"
  | "INVALID_ASPECT"
  | "MISSING_SOURCE"
  | "NETWORK"
  | "UNAVAILABLE"
  | "CORRUPT";

export type PlaybackFailure = {
  code: PlaybackErrorCode;
  /** Safe user-facing category — never raw exception text. */
  reason: string;
  retryable: boolean;
};

export type ResolvedPlayback = {
  url: string;
  posterUrl: string;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
  aspectRatio: number;
  expiresAt: string | null;
  preloadHint: PlaybackDescriptor["preloadHint"];
  provider: PlaybackDescriptor["provider"];
  reference: string;
};

export type ResolvePlaybackResult =
  | { ok: true; playback: ResolvedPlayback }
  | { ok: false; error: PlaybackFailure };

export type VideoProvider = {
  resolve(descriptor: PlaybackDescriptor, now?: number): ResolvePlaybackResult;
  /** Soft availability check without network I/O for static refs. */
  validate(descriptor: PlaybackDescriptor, now?: number): ResolvePlaybackResult;
};

export function classifyPlaybackHttpStatus(status: number): PlaybackFailure {
  if (status === 404) {
    return { code: "NOT_FOUND", reason: "Episode media unavailable", retryable: false };
  }
  if (status === 403) {
    return { code: "FORBIDDEN", reason: "Episode media unavailable", retryable: false };
  }
  if (status >= 500) {
    return { code: "NETWORK", reason: "Playback temporarily unavailable", retryable: true };
  }
  return { code: "UNAVAILABLE", reason: "Playback unavailable", retryable: false };
}

export function classifyMediaError(code: number | null | undefined): PlaybackFailure {
  // HTMLMediaElement error codes: 1=ABORTED 2=NETWORK 3=DECODE 4=SRC_NOT_SUPPORTED
  if (code === 2) {
    return { code: "NETWORK", reason: "Playback temporarily unavailable", retryable: true };
  }
  if (code === 3) {
    return { code: "CORRUPT", reason: "Episode couldn’t play", retryable: false };
  }
  if (code === 4) {
    return { code: "UNSUPPORTED_MIME", reason: "Episode couldn’t play", retryable: false };
  }
  return { code: "UNAVAILABLE", reason: "Episode couldn’t play", retryable: false };
}

function isExpired(expiresAt: string | null, now: number): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  return Number.isFinite(ts) && ts <= now;
}

function joinBase(assetBaseUrl: string, reference: string): string {
  if (/^https?:\/\//i.test(reference)) return reference;
  if (reference.startsWith("/")) {
    if (!assetBaseUrl) return reference;
    return `${assetBaseUrl.replace(/\/$/, "")}${reference}`;
  }
  const base = assetBaseUrl.replace(/\/$/, "");
  return `${base}/${reference.replace(/^\//, "")}`;
}

export type StaticVideoProviderOptions = {
  /** Origin for relative `/content/...` refs (empty = same-origin path). */
  assetBaseUrl?: string;
};

/**
 * Simplest launch provider: static same-origin (or absolute) progressive media.
 * Future CDN/signed/HLS providers implement the same VideoProvider interface.
 */
export function createStaticVideoProvider(
  options: StaticVideoProviderOptions = {},
): VideoProvider {
  const assetBaseUrl = options.assetBaseUrl ?? "";

  function resolve(
    descriptor: PlaybackDescriptor,
    now: number = Date.now(),
  ): ResolvePlaybackResult {
    if (!descriptor.reference.trim()) {
      return {
        ok: false,
        error: {
          code: "MISSING_SOURCE",
          reason: "Episode media unavailable",
          retryable: false,
        },
      };
    }
    if (isExpired(descriptor.expiresAt, now)) {
      return {
        ok: false,
        error: {
          code: "EXPIRED",
          reason: "Episode media unavailable",
          retryable: false,
        },
      };
    }
    if (descriptor.provider !== "static" && descriptor.provider !== "cdn") {
      // L1: only static/cdn progressive URLs; signed/hls reserved.
      if (descriptor.provider === "signed" || descriptor.provider === "hls") {
        // Still resolve URL if reference is absolute/playable — soft support.
      }
    }

    const url = joinBase(assetBaseUrl, descriptor.reference);
    const posterUrl = joinBase(assetBaseUrl, descriptor.posterReference);
    return {
      ok: true,
      playback: {
        url,
        posterUrl,
        mimeType: descriptor.mimeType,
        durationMs: descriptor.durationMs,
        width: descriptor.width,
        height: descriptor.height,
        aspectRatio: descriptor.aspectRatio,
        expiresAt: descriptor.expiresAt,
        preloadHint: descriptor.preloadHint,
        provider: descriptor.provider,
        reference: descriptor.reference,
      },
    };
  }

  return {
    resolve,
    validate: resolve,
  };
}
