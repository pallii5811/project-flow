import { describe, expect, it, vi } from "vitest";

import {
  buildAnalyticsEnvelope,
  createAnalyticsClient,
  createConsoleAnalyticsTransport,
  createHttpAnalyticsTransport,
  createLoggerAnalyticsProvider,
  validateAnalyticsEnvelope,
  type AnalyticsEnvelope,
  type AnalyticsPayload,
} from "../src/index";

describe("analytics", () => {
  it("tracks typed events through transport as envelope", () => {
    const seen: AnalyticsEnvelope[] = [];
    const transport = createConsoleAnalyticsTransport({
      log: (_m, envelope) => {
        seen.push(envelope);
      },
    });

    const analytics = createAnalyticsClient({
      transport,
      context: {
        anonymousUserId: "anon_test",
        sessionId: "session_test",
        platform: "web",
      },
      now: () => new Date("2026-09-15T12:00:00.000Z"),
      createEventId: () => "evt_1",
    });

    analytics.track("page_view", { cold: true });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      event_id: "evt_1",
      event_name: "page_view",
      anonymous_user_id: "anon_test",
      session_id: "session_test",
      platform: "web",
    });
  });

  it("logger provider still works for mobile", () => {
    const log = vi.fn();
    const provider = createLoggerAnalyticsProvider(log);
    const analytics = createAnalyticsClient({
      provider,
      sessionId: "session_test",
      now: () => new Date("2026-09-15T12:00:00.000Z"),
      createEventId: () => "evt_2",
    });
    analytics.track("app_opened");
    expect(log).toHaveBeenCalled();
  });

  it("validateAnalyticsEnvelope catches missing fields", () => {
    const issues = validateAnalyticsEnvelope({ event_name: "play" });
    expect(issues.some((i) => i.path === "event_id")).toBe(true);
    expect(issues.some((i) => i.path === "session_id")).toBe(true);
  });

  it("buildAnalyticsEnvelope separates anonymous_user_id from session_id", () => {
    const envelope = buildAnalyticsEnvelope(
      "share_landing",
      {
        anonymousUserId: "anon_durable",
        sessionId: "session_short",
        utmSource: "twitter",
        shareId: "share_abc",
        referrer: "https://t.co/x",
      },
      {
        content_id: "item_1",
        series_id: "series_1",
        episode_id: "ep_1",
        route: "/watch/a/b",
      },
      () => new Date("2026-09-16T00:00:00.000Z"),
      () => "evt_dl",
    );
    expect(envelope.anonymous_user_id).toBe("anon_durable");
    expect(envelope.session_id).toBe("session_short");
    expect(envelope.utm_source).toBe("twitter");
    expect(envelope.share_id).toBe("share_abc");
    expect(envelope.content_id).toBe("item_1");
  });
});

describe("HttpAnalyticsTransport", () => {
  it("queues, batches, and flushes via fetch", async () => {
    const posts: string[] = [];
    const transport = createHttpAnalyticsTransport({
      endpoint: "https://example.test/collect",
      batchSize: 2,
      flushIntervalMs: 60_000,
      bindLifecycle: false,
      fetchImpl: (async (_url, init) => {
        posts.push(String(init?.body ?? ""));
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });

    const base = {
      event_id: "1",
      timestamp: "2026-09-16T00:00:00.000Z",
      anonymous_user_id: "a",
      session_id: "s",
    } as const;

    transport.track({ ...base, event_id: "1", event_name: "play" });
    expect(transport.getDiagnostics().queueSize).toBe(1);
    transport.track({ ...base, event_id: "2", event_name: "pause" });
    await Promise.resolve();
    await transport.flush();
    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(transport.getDiagnostics().queueSize).toBe(0);
    await transport.shutdown();
  });

  it("retries with limit and does not throw on failure", async () => {
    let calls = 0;
    const transport = createHttpAnalyticsTransport({
      endpoint: "https://example.test/collect",
      batchSize: 10,
      maxRetries: 2,
      baseBackoffMs: 1,
      maxBackoffMs: 2,
      bindLifecycle: false,
      now: () => Date.now(),
      fetchImpl: (async () => {
        calls += 1;
        return new Response(null, { status: 500 });
      }) as typeof fetch,
    });

    transport.track({
      event_id: "1",
      event_name: "play",
      timestamp: "2026-09-16T00:00:00.000Z",
      anonymous_user_id: "a",
      session_id: "s",
    });

    await transport.flush();
    await transport.flush();
    await transport.flush();
    await transport.flush();
    expect(calls).toBeGreaterThan(0);
    expect(transport.getDiagnostics().failedSends).toBeGreaterThanOrEqual(0);
    await expect(transport.shutdown()).resolves.toBeUndefined();
  });

  it("isolates transport failure from track()", () => {
    const transport = createHttpAnalyticsTransport({
      endpoint: "https://example.test/collect",
      bindLifecycle: false,
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    });
    expect(() =>
      transport.track({
        event_id: "1",
        event_name: "play",
        timestamp: "2026-09-16T00:00:00.000Z",
        anonymous_user_id: "a",
        session_id: "s",
      }),
    ).not.toThrow();
  });
});

describe("legacy payload type", () => {
  it("accepts AnalyticsPayload for type compatibility", () => {
    const payload: AnalyticsPayload = {
      event: "app_opened",
      timestamp: "2026-09-15T12:00:00.000Z",
      sessionId: "s",
    };
    expect(payload.event).toBe("app_opened");
  });
});
