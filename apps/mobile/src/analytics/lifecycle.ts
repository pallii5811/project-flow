import { AppState, type AppStateStatus } from "react-native";

import type { AnalyticsClient } from "@project-flow/analytics";

/**
 * Emits foundational lifecycle analytics. Safe to call once at bootstrap.
 */
export function bindAppLifecycleAnalytics(analytics: AnalyticsClient): () => void {
  analytics.track("app_opened");

  let previous: AppStateStatus = AppState.currentState;

  const subscription = AppState.addEventListener("change", (next) => {
    if (previous.match(/inactive|background/) && next === "active") {
      analytics.track("app_foregrounded");
    } else if (previous === "active" && next.match(/inactive|background/)) {
      analytics.track("app_backgrounded");
    }
    previous = next;
  });

  return () => {
    subscription.remove();
  };
}
