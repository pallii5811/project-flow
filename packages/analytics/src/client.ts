import { assertValidEnvelopeInDev } from "./validateEnvelope";
import type { AnalyticsTransport } from "./transport/types";
import { transportAsProvider } from "./transport/types";
import type {
  AnalyticsClient,
  AnalyticsEnvelope,
  AnalyticsEventName,
  AnalyticsProperties,
  AnalyticsProvider,
} from "./types";

export type AnalyticsContext = {
  anonymousUserId: string;
  sessionId: string;
  source?: string | null;
  locale?: string | null;
  country?: string | null;
  platform?: string | null;
  viewportClass?: string | null;
  appVersion?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  shareId?: string | null;
};

export type CreateAnalyticsOptions = {
  /** Preferred: transport abstraction (L1.5). */
  transport?: AnalyticsTransport;
  /** Legacy provider — used when transport omitted. */
  provider?: AnalyticsProvider;
  /** @deprecated Prefer context.sessionId */
  sessionId?: string;
  context?: AnalyticsContext;
  now?: () => Date;
  createEventId?: () => string;
};

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function pickContentFields(properties?: AnalyticsProperties): {
  content_id?: string | null;
  series_id?: string | null;
  episode_id?: string | null;
} {
  if (!properties) return {};
  const content_id =
    typeof properties.content_id === "string" || properties.content_id === null
      ? properties.content_id
      : undefined;
  const series_id =
    typeof properties.series_id === "string" || properties.series_id === null
      ? properties.series_id
      : undefined;
  const episode_id =
    typeof properties.episode_id === "string" || properties.episode_id === null
      ? properties.episode_id
      : undefined;
  return {
    ...(content_id !== undefined ? { content_id } : {}),
    ...(series_id !== undefined ? { series_id } : {}),
    ...(episode_id !== undefined ? { episode_id } : {}),
  };
}

export function buildAnalyticsEnvelope(
  event: AnalyticsEventName,
  context: AnalyticsContext,
  properties: AnalyticsProperties | undefined,
  now: () => Date,
  createEventId: () => string,
): AnalyticsEnvelope {
  return {
    event_id: createEventId(),
    event_name: event,
    timestamp: now().toISOString(),
    anonymous_user_id: context.anonymousUserId,
    session_id: context.sessionId,
    ...pickContentFields(properties),
    source: context.source ?? null,
    locale: context.locale ?? null,
    country: context.country ?? null,
    platform: context.platform ?? null,
    viewport_class: context.viewportClass ?? null,
    app_version: context.appVersion ?? null,
    referrer: context.referrer ?? null,
    utm_source: context.utmSource ?? null,
    utm_medium: context.utmMedium ?? null,
    utm_campaign: context.utmCampaign ?? null,
    share_id: context.shareId ?? null,
    ...(properties === undefined ? {} : { properties }),
  };
}

/**
 * session_id = short-lived usage context.
 * anonymous_user_id = durable anonymous product identity.
 * Transport is fire-and-forget — never blocks playback.
 */
export function createAnalyticsClient(
  options: CreateAnalyticsOptions,
): AnalyticsClient {
  const now = options.now ?? (() => new Date());
  const createEventId = options.createEventId ?? createId;
  const context: AnalyticsContext = options.context ?? {
    anonymousUserId: "anonymous_unknown",
    sessionId: options.sessionId ?? "session_unknown",
  };

  const transport = options.transport;
  const provider =
    options.provider ??
    (transport ? transportAsProvider(transport) : undefined);

  if (!provider && !transport) {
    throw new Error("createAnalyticsClient requires transport or provider");
  }

  const noopTransport: AnalyticsTransport = {
    track() {},
    async flush() {},
    identify() {},
    async shutdown() {},
    getDiagnostics() {
      return {
        transportType: "noop",
        queueSize: 0,
        lastEventName: null,
        lastEventAt: null,
        lastFlushAt: null,
        failedSends: 0,
        pendingRetries: 0,
      };
    },
  };

  const activeTransport = transport ?? noopTransport;

  return {
    track(event: AnalyticsEventName, properties?: AnalyticsProperties): void {
      try {
        const envelope = buildAnalyticsEnvelope(
          event,
          context,
          properties,
          now,
          createEventId,
        );
        assertValidEnvelopeInDev(envelope);
        if (transport) {
          transport.track(envelope);
        } else if (provider) {
          void provider.track(envelope);
        }
      } catch {
        // Analytics must never throw into the UI path.
      }
    },
    async flush() {
      try {
        await activeTransport.flush();
      } catch {
        // ignore
      }
    },
    identify(properties) {
      try {
        activeTransport.identify(properties);
      } catch {
        // ignore
      }
    },
    async shutdown() {
      try {
        await activeTransport.shutdown();
      } catch {
        // ignore
      }
    },
    getTransportDiagnostics() {
      return activeTransport.getDiagnostics();
    },
  };
}
