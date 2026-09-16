import { describe, expect, it } from "vitest";

import { createAppServices } from "./createAppServices";

describe("createAppServices", () => {
  it("boots foundational services without throwing", () => {
    const services = createAppServices({ NODE_ENV: "test" });

    expect(services.config.appName).toBe("PROJECT FLOW");
    expect(services.sessionId.length).toBeGreaterThan(0);
    expect(services.featureFlags.isEnabled("FEED_V0")).toBe(false);
    expect(() => services.analytics.track("app_opened")).not.toThrow();
  });

  it("enables FEED_V0 in development by default", () => {
    const services = createAppServices({ NODE_ENV: "development" });
    expect(services.featureFlags.isEnabled("FEED_V0")).toBe(true);
  });

  it("allows explicit FEED_V0 override", () => {
    expect(
      createAppServices({
        NODE_ENV: "development",
        EXPO_PUBLIC_FEED_V0: "0",
      }).featureFlags.isEnabled("FEED_V0"),
    ).toBe(false);
    expect(
      createAppServices({
        NODE_ENV: "production",
        EXPO_PUBLIC_FEED_V0: "1",
      }).featureFlags.isEnabled("FEED_V0"),
    ).toBe(true);
  });

  it("enables recommendation flags in development by default", () => {
    const services = createAppServices({ NODE_ENV: "development" });
    expect(services.featureFlags.isEnabled("RECOMMENDATION_V0")).toBe(true);
    expect(services.featureFlags.isEnabled("RECOMMENDATION_DIVERSITY_V0")).toBe(
      true,
    );
    expect(services.featureFlags.isEnabled("RECOMMENDATION_EXPLORATION_V0")).toBe(
      true,
    );
  });

  it("keeps recommendation off in production unless overridden", () => {
    const services = createAppServices({ NODE_ENV: "production" });
    expect(services.featureFlags.isEnabled("RECOMMENDATION_V0")).toBe(false);
  });

  it("keeps SCENE_GRAPH_SIGNALS_V0 off by default even in development", () => {
    const services = createAppServices({ NODE_ENV: "development" });
    expect(services.featureFlags.isEnabled("SCENE_GRAPH_SIGNALS_V0")).toBe(false);
  });

  it("enables INTENT_LAYER + chips in development; NL stays off", () => {
    const services = createAppServices({ NODE_ENV: "development" });
    expect(services.featureFlags.isEnabled("INTENT_LAYER")).toBe(true);
    expect(services.featureFlags.isEnabled("INTENT_CHIPS_V0")).toBe(true);
    expect(services.featureFlags.isEnabled("INTENT_NL_V0")).toBe(false);
  });

  it("keeps DEMAND_GRAPH_V0 off by default", () => {
    expect(
      createAppServices({ NODE_ENV: "development" }).featureFlags.isEnabled(
        "DEMAND_GRAPH_V0",
      ),
    ).toBe(false);
  });
});
