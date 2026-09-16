export const FEATURE_FLAGS = {
  FEED_V0: "FEED_V0",
  INTENT_LAYER: "INTENT_LAYER",
  INTENT_CHIPS_V0: "INTENT_CHIPS_V0",
  INTENT_NL_V0: "INTENT_NL_V0",
  RECOMMENDATION_V0: "RECOMMENDATION_V0",
  RECOMMENDATION_DIVERSITY_V0: "RECOMMENDATION_DIVERSITY_V0",
  RECOMMENDATION_EXPLORATION_V0: "RECOMMENDATION_EXPLORATION_V0",
  SCENE_GRAPH_SIGNALS_V0: "SCENE_GRAPH_SIGNALS_V0",
  DEMAND_GRAPH_V0: "DEMAND_GRAPH_V0",
} as const;

export type FeatureFlagName =
  (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

export type FeatureFlagDefaults = Record<FeatureFlagName, boolean>;

/** Local defaults: all product features off until their prompts land. */
export const DEFAULT_FEATURE_FLAGS: FeatureFlagDefaults = {
  FEED_V0: false,
  INTENT_LAYER: false,
  INTENT_CHIPS_V0: false,
  INTENT_NL_V0: false,
  RECOMMENDATION_V0: false,
  RECOMMENDATION_DIVERSITY_V0: false,
  RECOMMENDATION_EXPLORATION_V0: false,
  /** Scene Graph signals stay OFF — Recommendation V0 must not depend on them. */
  SCENE_GRAPH_SIGNALS_V0: false,
  /** Demand Graph is intelligence-only; default OFF so feed never depends on it. */
  DEMAND_GRAPH_V0: false,
};

export type FeatureFlagProvider = {
  isEnabled(flag: FeatureFlagName): boolean;
};

/**
 * Deterministic bucket assignment for future A/B (0–99).
 * Not a full experimentation platform — stable hash of key + salt.
 */
export function experimentBucket(key: string, salt = "flow"): number {
  let h = 2166136261;
  const input = `${salt}:${key}`;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

export function createLocalFeatureFlags(
  overrides: Partial<FeatureFlagDefaults> = {},
): FeatureFlagProvider {
  const flags: FeatureFlagDefaults = {
    ...DEFAULT_FEATURE_FLAGS,
    ...overrides,
  };

  return {
    isEnabled(flag: FeatureFlagName): boolean {
      return flags[flag];
    },
  };
}
