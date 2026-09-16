import { describe, expect, it } from "vitest";

import { assertConfig, createLocalFeatureFlags, loadConfig } from "../src/index";

describe("loadConfig", () => {
  it("defaults to development when env is empty", () => {
    const config = loadConfig({});
    expect(config.env).toBe("development");
    expect(config.appName).toBe("PROJECT FLOW");
  });

  it("accepts explicit FLOW_APP_ENV", () => {
    expect(loadConfig({ FLOW_APP_ENV: "production" }).env).toBe("production");
    expect(loadConfig({ FLOW_APP_ENV: "test" }).env).toBe("test");
  });

  it("rejects invalid FLOW_APP_ENV with a clear error", () => {
    expect(() => loadConfig({ FLOW_APP_ENV: "staging" })).toThrow(
      /Invalid FLOW_APP_ENV/,
    );
  });
});

describe("assertConfig", () => {
  it("passes for a valid config", () => {
    expect(() =>
      assertConfig({ env: "development", appName: "PROJECT FLOW" }),
    ).not.toThrow();
  });
});

describe("feature flags", () => {
  it("resolves local defaults as disabled", () => {
    const flags = createLocalFeatureFlags();
    expect(flags.isEnabled("FEED_V0")).toBe(false);
    expect(flags.isEnabled("INTENT_LAYER")).toBe(false);
    expect(flags.isEnabled("INTENT_CHIPS_V0")).toBe(false);
    expect(flags.isEnabled("INTENT_NL_V0")).toBe(false);
    expect(flags.isEnabled("RECOMMENDATION_V0")).toBe(false);
    expect(flags.isEnabled("RECOMMENDATION_DIVERSITY_V0")).toBe(false);
    expect(flags.isEnabled("RECOMMENDATION_EXPLORATION_V0")).toBe(false);
    expect(flags.isEnabled("SCENE_GRAPH_SIGNALS_V0")).toBe(false);
    expect(flags.isEnabled("DEMAND_GRAPH_V0")).toBe(false);
  });

  it("allows overrides", () => {
    const flags = createLocalFeatureFlags({
      FEED_V0: true,
      RECOMMENDATION_V0: true,
    });
    expect(flags.isEnabled("FEED_V0")).toBe(true);
    expect(flags.isEnabled("RECOMMENDATION_V0")).toBe(true);
  });
});
