import type {
  AnalyticsEnvelope,
  AnalyticsPayload,
  AnalyticsProperties,
} from "../types";

export type TransportDiagnostics = {
  transportType: string;
  queueSize: number;
  lastEventName: string | null;
  lastEventAt: string | null;
  lastFlushAt: string | null;
  failedSends: number;
  pendingRetries: number;
};

export type AnalyticsTransport = {
  track(envelope: AnalyticsEnvelope): void;
  flush(): Promise<void>;
  identify(properties?: AnalyticsProperties): void;
  shutdown(): Promise<void>;
  getDiagnostics(): TransportDiagnostics;
};

export type AnalyticsProvider = {
  track(payload: AnalyticsPayload | AnalyticsEnvelope): void | Promise<void>;
};

/** Adapt a transport to the legacy provider interface. */
export function transportAsProvider(transport: AnalyticsTransport): AnalyticsProvider {
  return {
    track(payload) {
      if ("event_name" in payload && "anonymous_user_id" in payload) {
        transport.track(payload);
        return;
      }
      const legacy = payload as AnalyticsPayload;
      transport.track({
        event_id: `legacy_${Date.now()}`,
        event_name: legacy.event,
        timestamp: legacy.timestamp,
        anonymous_user_id: "anonymous_unknown",
        session_id: legacy.sessionId,
        ...(legacy.properties ? { properties: legacy.properties } : {}),
      });
    },
  };
}
