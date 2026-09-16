import type { AnalyticsEnvelope, AnalyticsProperties } from "../types";
import type { AnalyticsTransport, TransportDiagnostics } from "./types";

type BeaconFn = (url: string, data: string) => boolean;

export type HttpAnalyticsTransportOptions = {
  endpoint: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxQueueSize?: number;
  fetchImpl?: typeof fetch;
  sendBeaconImpl?: BeaconFn;
  now?: () => number;
  bindLifecycle?: boolean;
};

type Queued = {
  envelope: AnalyticsEnvelope;
  attempts: number;
};

type MinimalWindow = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

function getGlobalProp<T>(name: string): T | null {
  if (typeof globalThis === "undefined") return null;
  const value = (globalThis as unknown as Record<string, unknown>)[name];
  return (value as T | undefined) ?? null;
}

/**
 * Production HTTP transport — memory queue, batching, limited retry, never throws.
 * DOM APIs accessed via globalThis so the package stays DOM-lib-free.
 */
export function createHttpAnalyticsTransport(
  options: HttpAnalyticsTransportOptions,
): AnalyticsTransport {
  const batchSize = options.batchSize ?? 20;
  const flushIntervalMs = options.flushIntervalMs ?? 5_000;
  const maxRetries = options.maxRetries ?? 3;
  const baseBackoffMs = options.baseBackoffMs ?? 500;
  const maxBackoffMs = options.maxBackoffMs ?? 15_000;
  const maxQueueSize = options.maxQueueSize ?? 200;
  const now = options.now ?? (() => Date.now());
  const fetchImpl =
    options.fetchImpl ??
    (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);

  const queue: Queued[] = [];
  let flushing = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let failedSends = 0;
  let pendingRetries = 0;
  let lastEventName: string | null = null;
  let lastEventAt: string | null = null;
  let lastFlushAt: string | null = null;
  let identifyProps: AnalyticsProperties = {};
  let disposed = false;
  let backoffUntil = 0;

  function enqueue(envelope: AnalyticsEnvelope): void {
    if (disposed) return;
    queue.push({ envelope, attempts: 0 });
    while (queue.length > maxQueueSize) {
      queue.shift();
    }
    lastEventName = envelope.event_name;
    lastEventAt = envelope.timestamp;
  }

  async function sendBatch(
    batch: AnalyticsEnvelope[],
    preferBeacon: boolean,
  ): Promise<boolean> {
    const body = JSON.stringify({
      events: batch,
      identify: Object.keys(identifyProps).length > 0 ? identifyProps : undefined,
    });

    const nav = getGlobalProp<{ sendBeacon?: BeaconFn }>("navigator");
    if (preferBeacon && nav && typeof nav.sendBeacon === "function") {
      const beacon = options.sendBeaconImpl ?? nav.sendBeacon.bind(nav);
      try {
        return beacon(options.endpoint, body);
      } catch {
        // fall through
      }
    }

    if (!fetchImpl) {
      failedSends += 1;
      return false;
    }

    try {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      });
      return response.ok;
    } catch {
      failedSends += 1;
      return false;
    }
  }

  async function flushInternal(preferBeacon = false): Promise<void> {
    if (disposed || flushing) return;
    if (queue.length === 0) return;
    if (now() < backoffUntil) return;

    flushing = true;
    try {
      const batchItems = queue.splice(0, batchSize);
      const envelopes = batchItems.map((item) => item.envelope);
      const ok = await sendBatch(envelopes, preferBeacon);
      lastFlushAt = new Date().toISOString();
      if (!ok) {
        pendingRetries = 0;
        for (const item of batchItems) {
          item.attempts += 1;
          if (item.attempts <= maxRetries) {
            queue.unshift(item);
            pendingRetries += 1;
          } else {
            failedSends += 1;
          }
        }
        const attempt = Math.min(
          maxRetries,
          batchItems.reduce((max, item) => Math.max(max, item.attempts), 0),
        );
        const delay = Math.min(
          maxBackoffMs,
          baseBackoffMs * 2 ** Math.max(0, attempt - 1),
        );
        backoffUntil = now() + delay;
      } else {
        pendingRetries = 0;
        backoffUntil = 0;
      }
    } finally {
      flushing = false;
    }
  }

  function onVisibility(): void {
    const doc = getGlobalProp<{ visibilityState?: string }>("document");
    if (!doc) return;
    if (doc.visibilityState === "hidden") {
      void flushInternal(true);
    }
  }

  function onPageHide(): void {
    void flushInternal(true);
  }

  const win = getGlobalProp<MinimalWindow>("window");
  const bindLifecycle = options.bindLifecycle ?? Boolean(win);

  if (bindLifecycle && win) {
    win.addEventListener("visibilitychange", onVisibility);
    win.addEventListener("pagehide", onPageHide);
    win.addEventListener("beforeunload", onPageHide);
    timer = setInterval(() => {
      void flushInternal(false);
    }, flushIntervalMs);
  }

  return {
    track(envelope) {
      try {
        enqueue(envelope);
        if (queue.length >= batchSize) {
          void flushInternal(false);
        }
      } catch {
        // never throw
      }
    },
    async flush() {
      try {
        await flushInternal(false);
      } catch {
        // never throw
      }
    },
    identify(properties) {
      if (!properties) return;
      identifyProps = { ...identifyProps, ...properties };
    },
    async shutdown() {
      disposed = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (bindLifecycle && win) {
        win.removeEventListener("visibilitychange", onVisibility);
        win.removeEventListener("pagehide", onPageHide);
        win.removeEventListener("beforeunload", onPageHide);
      }
      try {
        await flushInternal(true);
      } catch {
        // ignore
      }
    },
    getDiagnostics(): TransportDiagnostics {
      return {
        transportType: "http",
        queueSize: queue.length,
        lastEventName,
        lastEventAt,
        lastFlushAt,
        failedSends,
        pendingRetries,
      };
    },
  };
}
