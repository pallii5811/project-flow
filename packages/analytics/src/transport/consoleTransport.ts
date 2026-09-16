import type { AnalyticsEnvelope } from "../types";
import type { AnalyticsTransport, TransportDiagnostics } from "./types";

export type ConsoleAnalyticsTransportOptions = {
  enabled?: boolean;
  log?: (message: string, envelope: AnalyticsEnvelope) => void;
};

/**
 * DEV transport — preserves console debugging. No network.
 */
export function createConsoleAnalyticsTransport(
  options: ConsoleAnalyticsTransportOptions = {},
): AnalyticsTransport {
  const enabled = options.enabled !== false;
  const log =
    options.log ??
    ((message: string, envelope: AnalyticsEnvelope) => {
      // eslint-disable-next-line no-console -- intentional DEV sink
      console.log(message, envelope);
    });

  let lastEventName: string | null = null;
  let lastEventAt: string | null = null;
  let lastFlushAt: string | null = null;

  return {
    track(envelope) {
      if (!enabled) return;
      lastEventName = envelope.event_name;
      lastEventAt = envelope.timestamp;
      try {
        log(`[analytics] ${envelope.event_name}`, envelope);
      } catch {
        // never throw
      }
    },
    async flush() {
      lastFlushAt = new Date().toISOString();
    },
    identify() {
      // no-op for console
    },
    async shutdown() {
      lastFlushAt = new Date().toISOString();
    },
    getDiagnostics(): TransportDiagnostics {
      return {
        transportType: "console",
        queueSize: 0,
        lastEventName,
        lastEventAt,
        lastFlushAt,
        failedSends: 0,
        pendingRetries: 0,
      };
    },
  };
}
