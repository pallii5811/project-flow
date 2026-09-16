import { getTheme, type ThemeName } from "@project-flow/design-system";
import { ThemeProvider } from "@project-flow/ui";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { View } from "react-native";

import { bindAppLifecycleAnalytics } from "./src/analytics/lifecycle";
import { createAppServices } from "./src/bootstrap/createAppServices";
import { DesignSystemShowcase } from "./src/dev/DesignSystemShowcase";
import { DevMenu, type DevSurface } from "./src/dev/DevMenu";
import { DevPhoneFrame } from "./src/dev/DevPhoneFrame";
import { DemandGraphInspector } from "./src/features/demand-graph/ui/DemandGraphInspector";
import { FeedScreen } from "./src/features/feed/ui/FeedScreen";
import { SceneGraphInspector } from "./src/features/scene-graph/ui/SceneGraphInspector";
import { PlaceholderScreen } from "./src/screens/PlaceholderScreen";

const services = createAppServices();
const feedEnabled = services.featureFlags.isEnabled("FEED_V0");
const recommendationEnabled = services.featureFlags.isEnabled("RECOMMENDATION_V0");
const diversityEnabled = services.featureFlags.isEnabled(
  "RECOMMENDATION_DIVERSITY_V0",
);
const explorationEnabled = services.featureFlags.isEnabled(
  "RECOMMENDATION_EXPLORATION_V0",
);
const intentLayerEnabled = services.featureFlags.isEnabled("INTENT_LAYER");
const intentChipsEnabled = services.featureFlags.isEnabled("INTENT_CHIPS_V0");
const intentNlEnabled = services.featureFlags.isEnabled("INTENT_NL_V0");
const demandGraphEnabled = services.featureFlags.isEnabled("DEMAND_GRAPH_V0");
const sceneGraphSignalsEnabled = services.featureFlags.isEnabled(
  "SCENE_GRAPH_SIGNALS_V0",
);

export default function App(): ReactElement {
  const [themeName, setThemeName] = useState<ThemeName>("dark");
  const [devSurface, setDevSurface] = useState<DevSurface>("product");

  const theme = useMemo(() => getTheme(themeName), [themeName]);
  const onThemeNameChange = useCallback((name: ThemeName) => {
    setThemeName(name);
  }, []);

  useEffect(() => {
    return bindAppLifecycleAnalytics(services.analytics);
  }, []);

  const statusStyle = themeName === "dark" ? "light" : "dark";

  let body: ReactElement;
  if (__DEV__ && devSurface === "demand-graph") {
    body = <DemandGraphInspector />;
  } else if (__DEV__ && devSurface === "scene-graph") {
    body = <SceneGraphInspector />;
  } else if (__DEV__ && devSurface === "design-system") {
    body = <DesignSystemShowcase />;
  } else if (feedEnabled) {
    body = (
      <FeedScreen
        analytics={services.analytics}
        sessionId={services.sessionId}
        recommendationEnabled={recommendationEnabled}
        diversityEnabled={diversityEnabled}
        explorationEnabled={explorationEnabled}
        intentLayerEnabled={intentLayerEnabled}
        intentChipsEnabled={intentChipsEnabled}
        intentNlEnabled={intentNlEnabled}
        demandGraphEnabled={demandGraphEnabled}
      />
    );
  } else {
    body = (
      <PlaceholderScreen
        onOpenDesignSystem={
          __DEV__ ? () => setDevSurface("design-system") : undefined
        }
      />
    );
  }

  const framed =
    __DEV__ && (devSurface === "product" || !feedEnabled) ? (
      <DevPhoneFrame>{body}</DevPhoneFrame>
    ) : (
      body
    );

  return (
    <ThemeProvider
      theme={theme}
      themeName={themeName}
      onThemeNameChange={onThemeNameChange}
    >
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {framed}
        <DevMenu surface={devSurface} onSelect={setDevSurface} />
      </View>
      <StatusBar style={statusStyle} />
    </ThemeProvider>
  );
}

/** Exported for smoke tests — verifies app module loads. */
export const __appBootProbe = {
  appName: services.config.appName,
  feedEnabled,
  recommendationEnabled,
  intentLayerEnabled,
  demandGraphEnabled,
  sceneGraphSignalsEnabled,
};
