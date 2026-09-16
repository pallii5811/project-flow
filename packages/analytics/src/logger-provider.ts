import { createConsoleAnalyticsTransport } from "./transport/consoleTransport";
import { transportAsProvider } from "./transport/types";
import type { AnalyticsEnvelope, AnalyticsPayload, AnalyticsProvider } from "./types";

/**
 * @deprecated Prefer createConsoleAnalyticsTransport + transportAsProvider.
 * Kept for mobile/bootstrap compatibility.
 */
export function createLoggerAnalyticsProvider(
  log: (message: string, payload: AnalyticsPayload | AnalyticsEnvelope) => void = defaultLog,
): AnalyticsProvider {
  const transport = createConsoleAnalyticsTransport({
    log: (message, envelope) => log(message, envelope),
  });
  return transportAsProvider(transport);
}

function defaultLog(
  message: string,
  payload: AnalyticsPayload | AnalyticsEnvelope,
): void {
  // eslint-disable-next-line no-console -- intentional local-dev sink
  console.log(message, payload);
}
