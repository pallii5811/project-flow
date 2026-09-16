import {
  createAnalyticsClient,
  createCompositeAnalyticsTransport,
  createConsoleAnalyticsTransport,
  createHttpAnalyticsTransport,
  type AnalyticsClient,
  type AnalyticsTransport,
} from "@project-flow/analytics";
import {
  assertConfig,
  createLocalFeatureFlags,
  loadConfig,
  type AppConfig,
  type FeatureFlagProvider,
} from "@project-flow/shared";

export type AppServices = {
  config: AppConfig;
  featureFlags: FeatureFlagProvider;
  analytics: AnalyticsClient;
  sessionId: string;
};

function createSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveBoolFlag(
  env: NodeJS.ProcessEnv,
  keys: string[],
  defaultValue: boolean,
): boolean {
  for (const key of keys) {
    const explicit = env[key];
    if (explicit === "1" || explicit === "true") return true;
    if (explicit === "0" || explicit === "false") return false;
  }
  return defaultValue;
}

function resolveFeedFlag(env: NodeJS.ProcessEnv, appEnv: AppConfig["env"]): boolean {
  return resolveBoolFlag(
    env,
    ["EXPO_PUBLIC_FEED_V0", "FLOW_FEED_V0"],
    appEnv === "development",
  );
}

function resolveRecommendationFlag(
  env: NodeJS.ProcessEnv,
  appEnv: AppConfig["env"],
): boolean {
  // Dev default ON with feed so Prompt E is verifiable; production off until launched.
  return resolveBoolFlag(
    env,
    ["EXPO_PUBLIC_RECOMMENDATION_V0", "FLOW_RECOMMENDATION_V0"],
    appEnv === "development",
  );
}

/** Composition root — keep UI free of service construction. */
export function createAppServices(
  env: NodeJS.ProcessEnv = process.env,
): AppServices {
  const config = loadConfig({
    FLOW_APP_ENV: env.FLOW_APP_ENV,
    NODE_ENV: env.NODE_ENV,
  });
  assertConfig(config);

  const sessionId = createSessionId();
  const recommendationOn = resolveRecommendationFlag(env, config.env);
  const intentLayerOn = resolveBoolFlag(
    env,
    ["EXPO_PUBLIC_INTENT_LAYER", "FLOW_INTENT_LAYER"],
    config.env === "development",
  );
  const featureFlags = createLocalFeatureFlags({
    FEED_V0: resolveFeedFlag(env, config.env),
    INTENT_LAYER: intentLayerOn,
    INTENT_CHIPS_V0: resolveBoolFlag(
      env,
      ["EXPO_PUBLIC_INTENT_CHIPS_V0", "FLOW_INTENT_CHIPS_V0"],
      intentLayerOn,
    ),
    // Validate chips before free-form NL ambiguity.
    INTENT_NL_V0: resolveBoolFlag(
      env,
      ["EXPO_PUBLIC_INTENT_NL_V0", "FLOW_INTENT_NL_V0"],
      false,
    ),
    RECOMMENDATION_V0: recommendationOn,
    RECOMMENDATION_DIVERSITY_V0: resolveBoolFlag(
      env,
      ["EXPO_PUBLIC_RECOMMENDATION_DIVERSITY_V0", "FLOW_RECOMMENDATION_DIVERSITY_V0"],
      recommendationOn,
    ),
    RECOMMENDATION_EXPLORATION_V0: resolveBoolFlag(
      env,
      [
        "EXPO_PUBLIC_RECOMMENDATION_EXPLORATION_V0",
        "FLOW_RECOMMENDATION_EXPLORATION_V0",
      ],
      recommendationOn,
    ),
    // Explicit opt-in only — never auto-enable Scene Graph ranking signals.
    SCENE_GRAPH_SIGNALS_V0: resolveBoolFlag(
      env,
      ["EXPO_PUBLIC_SCENE_GRAPH_SIGNALS_V0", "FLOW_SCENE_GRAPH_SIGNALS_V0"],
      false,
    ),
    DEMAND_GRAPH_V0: resolveBoolFlag(
      env,
      ["EXPO_PUBLIC_DEMAND_GRAPH_V0", "FLOW_DEMAND_GRAPH_V0"],
      false,
    ),
  });
  const analyticsEndpoint =
    env.EXPO_PUBLIC_ANALYTICS_ENDPOINT?.trim() ||
    env.FLOW_ANALYTICS_ENDPOINT?.trim() ||
    "";
  const transports: AnalyticsTransport[] = [
    createConsoleAnalyticsTransport({
      enabled: config.env !== "production" || !analyticsEndpoint,
    }),
  ];
  if (analyticsEndpoint) {
    transports.push(
      createHttpAnalyticsTransport({
        endpoint: analyticsEndpoint,
        bindLifecycle: false,
      }),
    );
  }
  const transport =
    transports.length === 1
      ? transports[0]!
      : createCompositeAnalyticsTransport(transports);

  const analytics = createAnalyticsClient({
    transport,
    sessionId,
    context: {
      anonymousUserId: `anon_mobile_${sessionId}`,
      sessionId,
      platform: "mobile",
      source: "apps/mobile",
    },
  });

  return {
    config,
    featureFlags,
    analytics,
    sessionId,
  };
}
