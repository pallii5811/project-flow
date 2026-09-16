import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { createAnalyticsClient, createLoggerAnalyticsProvider } from "@project-flow/analytics";
import { Pressable, Screen, Stack, Text, useTheme } from "@project-flow/ui";

import { MOCK_CATALOG } from "../../feed/data/catalog";
import { createDeterministicFeedSource } from "../../feed/source/deterministicFeedSource";
import { createIntentParser } from "../../intent/parser/createIntentParser";
import type { DemandPatternRecord } from "../model/types";
import {
  createDemandGraphService,
  type DemandGraphService,
} from "../service/createDemandGraphService";

/**
 * DEV-ONLY Demand Graph inspector.
 * Distinguishes OBSERVED FACT vs INFERENCE. Not a consumer surface.
 */
export function DemandGraphInspector(): ReactElement {
  const theme = useTheme();
  const [patterns, setPatterns] = useState<DemandPatternRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [seeded, setSeeded] = useState(false);

  const service = useMemo(() => {
    const analytics = createAnalyticsClient({
      provider: createLoggerAnalyticsProvider(() => {}),
      sessionId: "dev_demand_inspector",
    });
    const catalog = createDeterministicFeedSource(MOCK_CATALOG).getOrderedItems();
    return createDemandGraphService({
      analytics,
      catalog,
      enabled: true,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!seeded) {
        await seedDemo(service);
        if (!cancelled) setSeeded(true);
      }
      const list = await service.query({ limit: 30 });
      if (!cancelled) {
        setPatterns(list);
        setSelectedId((id) => id || list[0]?.patternId || "");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seeded, service]);

  const selected = patterns.find((p) => p.patternId === selectedId);

  return (
    <Screen testID="demand-graph-inspector" style={{ paddingHorizontal: theme.spacing.md }}>
      <ScrollView>
        <Stack gap="md" style={{ paddingVertical: theme.spacing.lg }}>
          <Text variant="caption" tone="subtle">
            DEV · DEMAND GRAPH
          </Text>
          <Text variant="headlineMedium">Demand Graph</Text>
          <Text variant="bodyMedium" tone="muted">
            Internal market intelligence. Query volume ≠ demand.
          </Text>

          <Text variant="labelMedium">Patterns</Text>
          <View style={{ gap: theme.spacing.xs }}>
            {patterns.map((p) => (
              <Pressable
                key={p.patternId}
                onPress={() => setSelectedId(p.patternId)}
                style={{
                  padding: theme.spacing.sm,
                  borderRadius: theme.radii.md,
                  backgroundColor:
                    p.patternId === selectedId
                      ? theme.colors.accent
                      : theme.colors.surfaceElevated,
                }}
              >
                <Text
                  variant="caption"
                  style={{
                    color:
                      p.patternId === selectedId
                        ? theme.colors.accentForeground
                        : theme.colors.foreground,
                  }}
                >
                  {p.state} · {p.gapKind} · {p.canonicalKey.slice(0, 48)}…
                </Text>
              </Pressable>
            ))}
            {patterns.length === 0 ? (
              <Text variant="caption" tone="muted">
                No patterns yet.
              </Text>
            ) : null}
          </View>

          {selected ? <PatternDetail pattern={selected} /> : null}
        </Stack>
      </ScrollView>
    </Screen>
  );
}

function PatternDetail({ pattern }: { pattern: DemandPatternRecord }): ReactElement {
  const theme = useTheme();
  const e = pattern.evidence;
  return (
    <View
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radii.md,
        backgroundColor: theme.colors.surface,
      }}
    >
      <Text variant="titleSmall">{pattern.patternId}</Text>
      <Fact label="OBSERVED state" value={pattern.state} />
      <Fact label="OBSERVED gap kind" value={pattern.gapKind} />
      <Fact
        label="OBSERVED unique users"
        value={String(e.uniqueUsers)}
      />
      <Fact label="OBSERVED requests (raw)" value={String(e.requestCount)} />
      <Fact
        label="OBSERVED capped requests"
        value={String(e.cappedRequestCount)}
      />
      <Fact label="OBSERVED repeat users" value={String(e.repeatUsers)} />
      <Fact
        label="OBSERVED related completions"
        value={String(e.relatedContentCompletions)}
      />
      <Fact
        label="OBSERVED related completion rate"
        value={e.relatedCompletionRate.toFixed(2)}
      />
      <Fact
        label="OBSERVED closest content"
        value={
          pattern.closestContent
            ? `${pattern.closestContent.contentId} (overlap ${pattern.closestContent.overlapScore.toFixed(2)})`
            : "—"
        }
      />
      <Fact
        label="OBSERVED languages"
        value={JSON.stringify(pattern.segments.byLanguage)}
      />
      <Fact
        label="OBSERVED countries"
        value={JSON.stringify(pattern.segments.byCountry)}
      />
      <Text variant="caption" tone="muted">
        INFERENCE: confidence {pattern.confidenceLevel} ({pattern.confidenceScore}) —
        evidence volume only, not predicted viewers.
      </Text>
      <Text variant="caption" tone="muted">
        Timeline: first {new Date(pattern.firstSeen).toISOString()} · last{" "}
        {new Date(pattern.lastSeen).toISOString()}
      </Text>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <Text variant="caption">
      <Text variant="caption" tone="muted">
        {label}:{" "}
      </Text>
      {value}
    </Text>
  );
}

async function seedDemo(service: DemandGraphService): Promise<void> {
  const parser = createIntentParser();
  const ctx = {
    contentId: "item_ember_1",
    seriesId: "series_ember",
    episodeId: "ep_ember_1",
    genres: ["romance", "drama"],
    tropes: ["betrayal"],
    language: "en",
    recentContentIds: [],
  };
  const chip = parser.parseChip("MORE_REVENGE", ctx);
  for (let i = 0; i < 12; i += 1) {
    await service.ingest({
      source: i < 10 ? "intent_weak_match" : "intent_result_completed",
      intent: { ...chip.intent, intentId: `seed_${i}` },
      resultCount: 1,
      matchStrength: 0.2,
      anonymousIdHash: `user_${i % 10}`,
      dedupeKey: `seed_dedupe_${i}`,
      language: i % 3 === 0 ? "pt" : "en",
      country: i % 3 === 0 ? "BR" : "US",
      relatedContentId: "item_velvet_1",
      now: Date.now() - (12 - i) * 60_000,
    });
  }
  for (let i = 0; i < 8; i += 1) {
    await service.recordRelatedBehavior({
      contentId: "item_velvet_1",
      kind: i % 2 === 0 ? "play" : "complete",
      anonymousIdHash: `user_${i}`,
    });
  }
}
