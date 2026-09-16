import type { AnalyticsEnvelope, AnalyticsProperties } from "../types";
import type { AnalyticsTransport, TransportDiagnostics } from "./types";

/** Fan-out to multiple transports (e.g. console + http in DEV). */
export function createCompositeAnalyticsTransport(
  transports: AnalyticsTransport[],
): AnalyticsTransport {
  return {
    track(envelope: AnalyticsEnvelope) {
      for (const transport of transports) {
        try {
          transport.track(envelope);
        } catch {
          // isolate
        }
      }
    },
    async flush() {
      await Promise.all(
        transports.map(async (transport) => {
          try {
            await transport.flush();
          } catch {
            // isolate
          }
        }),
      );
    },
    identify(properties?: AnalyticsProperties) {
      for (const transport of transports) {
        try {
          transport.identify(properties);
        } catch {
          // isolate
        }
      }
    },
    async shutdown() {
      await Promise.all(
        transports.map(async (transport) => {
          try {
            await transport.shutdown();
          } catch {
            // isolate
          }
        }),
      );
    },
    getDiagnostics(): TransportDiagnostics {
      const http = transports.find((t) => t.getDiagnostics().transportType === "http");
      if (http) return http.getDiagnostics();
      return (
        transports[0]?.getDiagnostics() ?? {
          transportType: "composite",
          queueSize: 0,
          lastEventName: null,
          lastEventAt: null,
          lastFlushAt: null,
          failedSends: 0,
          pendingRetries: 0,
        }
      );
    },
  };
}
