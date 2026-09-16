import {
  createAnalyticsClient,
  createCompositeAnalyticsTransport,
  createConsoleAnalyticsTransport,
  createHttpAnalyticsTransport,
  type AnalyticsClient,
  type AnalyticsTransport,
} from "@project-flow/analytics";

import {
  captureAcquisitionFromLocation,
  getOrCreateAnonymousUserId,
  getOrCreateSessionId,
  viewportClass,
} from "./session";

let client: AnalyticsClient | null = null;
let transport: AnalyticsTransport | null = null;

function resolveTransport(): AnalyticsTransport {
  if (transport) return transport;

  const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT?.trim() ?? "";
  const isProd = process.env.NODE_ENV === "production";
  const transports: AnalyticsTransport[] = [];

  if (!isProd || !endpoint) {
    transports.push(createConsoleAnalyticsTransport({ enabled: !isProd || !endpoint }));
  }

  if (endpoint) {
    transports.push(
      createHttpAnalyticsTransport({
        endpoint,
        batchSize: 20,
        flushIntervalMs: 5_000,
        maxRetries: 3,
      }),
    );
  }

  transport =
    transports.length === 1
      ? transports[0]!
      : createCompositeAnalyticsTransport(transports);
  return transport;
}

/**
 * Lazy analytics client — constructed after first paint request, never blocks boot.
 * Switch console → HTTP via NEXT_PUBLIC_ANALYTICS_ENDPOINT.
 */
export function getAnalyticsClient(): AnalyticsClient {
  if (client) return client;
  const sessionId = getOrCreateSessionId();
  const anonymousUserId = getOrCreateAnonymousUserId();
  const acquisition = captureAcquisitionFromLocation();
  const width = typeof window !== "undefined" ? window.innerWidth : 390;
  const activeTransport = resolveTransport();

  client = createAnalyticsClient({
    transport: activeTransport,
    context: {
      anonymousUserId,
      sessionId,
      platform: "web",
      locale: typeof navigator !== "undefined" ? navigator.language : "en",
      viewportClass: viewportClass(width),
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
      referrer: acquisition.referrer,
      utmSource: acquisition.utmSource,
      utmMedium: acquisition.utmMedium,
      utmCampaign: acquisition.utmCampaign,
      shareId: acquisition.shareId,
      source: "apps/web",
    },
  });
  return client;
}

export function getAnalyticsTransport(): AnalyticsTransport {
  return resolveTransport();
}

export function getSessionId(): string {
  return getOrCreateSessionId();
}

export function getAnonymousUserId(): string {
  return getOrCreateAnonymousUserId();
}
