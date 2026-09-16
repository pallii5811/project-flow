import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { Pressable, Screen, Stack, Text, useTheme } from "@project-flow/ui";

import type { SceneGraphDocument, SceneNode } from "../model/types";
import { createMockSceneGraphDocument } from "../fixtures/mockSceneGraph";
import { validateSceneGraph } from "../validation/validateSceneGraph";

/**
 * DEV-ONLY Scene Graph inspector.
 * Not a consumer product screen / CMS.
 */
export function SceneGraphInspector(): ReactElement {
  const theme = useTheme();
  const doc = useMemo(() => createMockSceneGraphDocument(), []);
  const validation = useMemo(() => validateSceneGraph(doc), [doc]);

  const [seriesId, setSeriesId] = useState(doc.series[0]?.id ?? "");
  const [episodeId, setEpisodeId] = useState(
    doc.episodes.find((e) => e.seriesId === doc.series[0]?.id)?.id ?? "",
  );
  const [sceneId, setSceneId] = useState<string>("");

  const episodes = doc.episodes.filter((e) => e.seriesId === seriesId);
  const scenes = doc.scenes
    .filter((s) => s.episodeId === episodeId)
    .sort((a, b) => a.sequence - b.sequence);
  const scene: SceneNode | undefined =
    scenes.find((s) => s.id === sceneId) ?? scenes[0];

  useEffect(() => {
    const firstEp = doc.episodes.find((e) => e.seriesId === seriesId);
    setEpisodeId(firstEp?.id ?? "");
  }, [doc.episodes, seriesId]);

  useEffect(() => {
    setSceneId(scenes[0]?.id ?? "");
    // ponytail: reset selection when episode changes; scenes is derived from episodeId
  }, [episodeId]);

  return (
    <Screen testID="scene-graph-inspector" style={{ paddingHorizontal: theme.spacing.md }}>
      <ScrollView>
        <Stack gap="md" style={{ paddingVertical: theme.spacing.lg }}>
          <Text variant="caption" tone="subtle">
            DEV · SCENE GRAPH
          </Text>
          <Text variant="headlineMedium">Scene Graph</Text>
          <Text variant="bodyMedium" tone="muted">
            Content intelligence inspection — not a consumer surface.
          </Text>
          <Text variant="caption" tone="muted">
            validation: {validation.ok ? "ok" : "errors"} · warnings{" "}
            {validation.warnings.length} · scenes {doc.scenes.length}
          </Text>

          <Text variant="labelMedium">Series</Text>
          <RowChips
            items={doc.series.map((s) => ({ id: s.id, label: s.title }))}
            selectedId={seriesId}
            onSelect={setSeriesId}
          />

          <Text variant="labelMedium">Episode</Text>
          <RowChips
            items={episodes.map((e) => ({
              id: e.id,
              label: `E${e.episodeNumber} ${e.title}`,
            }))}
            selectedId={episodeId}
            onSelect={setEpisodeId}
          />

          <Text variant="labelMedium">Scene</Text>
          <RowChips
            items={scenes.map((s) => ({
              id: s.id,
              label: s.title ?? s.id,
            }))}
            selectedId={scene?.id ?? ""}
            onSelect={setSceneId}
          />

          {scene ? (
            <SceneDetail doc={doc} scene={scene} />
          ) : (
            <Text variant="bodyMedium">No scenes for this episode.</Text>
          )}
        </Stack>
      </ScrollView>
    </Screen>
  );
}

function SceneDetail({
  doc,
  scene,
}: {
  doc: SceneGraphDocument;
  scene: SceneNode;
}): ReactElement {
  const theme = useTheme();
  const characters = doc.characters.filter((c) =>
    scene.characterIds.includes(c.id),
  );

  return (
    <View
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radii.md,
        backgroundColor: theme.colors.surface,
      }}
    >
      <Text variant="titleSmall">{scene.title ?? scene.id}</Text>
      <Meta label="timing" value={`${scene.startMs}–${scene.endMs} ms (${scene.durationMs})`} />
      <Meta label="sequence" value={String(scene.sequence)} />
      <Meta label="genres" value={scene.genres.join(", ") || "—"} />
      <Meta label="tropes" value={scene.tropes.join(", ") || "—"} />
      <Meta label="tone" value={scene.emotionalTone ?? "—"} />
      <Meta label="intensity" value={fmt(scene.emotionalIntensity)} />
      <Meta label="beat" value={scene.narrativeBeat ?? "—"} />
      <Meta label="cliffhanger" value={fmt(scene.cliffhangerStrength)} />
      <Meta label="hook" value={fmt(scene.hookStrength)} />
      <Meta label="romance" value={fmt(scene.romanceIntensity)} />
      <Meta label="suspense" value={fmt(scene.suspenseIntensity)} />
      <Meta label="confidence" value={fmt(scene.metadataConfidence)} />
      <Meta label="source" value={scene.source} />
      <Meta
        label="versions"
        value={`schema ${scene.schemaVersion} / meta ${scene.metadataVersion}`}
      />
      <Text variant="caption" tone="muted">
        characters:{" "}
        {characters.map((c) => `${c.canonicalName} (${c.role})`).join("; ") || "—"}
      </Text>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <Text variant="caption">
      <Text variant="caption" tone="muted">
        {label}:{" "}
      </Text>
      {value}
    </Text>
  );
}

function fmt(n: number | undefined): string {
  return n === undefined ? "—" : n.toFixed(2);
}

function RowChips({
  items,
  selectedId,
  onSelect,
}: {
  items: { id: string; label: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
}): ReactElement {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.xs }}>
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <Pressable
            key={item.id}
            onPress={() => onSelect(item.id)}
            style={{
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: theme.spacing.xs,
              borderRadius: theme.radii.sm,
              backgroundColor: selected
                ? theme.colors.accent
                : theme.colors.surfaceElevated,
            }}
          >
            <Text
              variant="caption"
              style={{
                color: selected
                  ? theme.colors.accentForeground
                  : theme.colors.foreground,
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
