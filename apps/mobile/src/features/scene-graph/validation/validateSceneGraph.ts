import {
  isCharacterRole,
  isEmotionalTone,
  isMetadataSource,
  isNarrativeBeat,
  isRelationshipType,
  isSceneGenre,
  isSceneTrope,
  SCHEMA_VERSION,
} from "../model/taxonomy";
import type { SceneGraphDocument, SceneNode } from "../model/types";

export type ValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

function intensityOk(value: number | undefined): boolean {
  if (value === undefined) return true;
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateScene(
  scene: SceneNode,
  index: number,
  characterIds: Set<string>,
  episodeIds: Set<string>,
  seriesIds: Set<string>,
  relationshipIds: Set<string>,
): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const path = `scenes[${index}]`;

  if (!scene.id.trim()) {
    errors.push(issue("missing_id", `${path}.id`, "Scene id is required"));
  }
  if (!seriesIds.has(scene.seriesId)) {
    errors.push(
      issue("unknown_series", `${path}.seriesId`, `Unknown series ${scene.seriesId}`),
    );
  }
  if (!episodeIds.has(scene.episodeId)) {
    errors.push(
      issue(
        "unknown_episode",
        `${path}.episodeId`,
        `Unknown episode ${scene.episodeId}`,
      ),
    );
  }
  if (scene.startMs < 0) {
    errors.push(issue("invalid_timing", `${path}.startMs`, "startMs must be >= 0"));
  }
  if (!(scene.endMs > scene.startMs)) {
    errors.push(
      issue("invalid_timing", `${path}.endMs`, "endMs must be > startMs"),
    );
  }
  if (scene.durationMs !== scene.endMs - scene.startMs) {
    errors.push(
      issue(
        "invalid_duration",
        `${path}.durationMs`,
        "durationMs must equal endMs - startMs",
      ),
    );
  }
  if (scene.schemaVersion !== SCHEMA_VERSION) {
    errors.push(
      issue(
        "schema_version",
        `${path}.schemaVersion`,
        `Expected schemaVersion ${SCHEMA_VERSION}`,
      ),
    );
  }
  if (!intensityOk(scene.metadataConfidence)) {
    errors.push(
      issue(
        "invalid_confidence",
        `${path}.metadataConfidence`,
        "confidence must be 0–1",
      ),
    );
  }
  if (!isMetadataSource(scene.source)) {
    errors.push(issue("invalid_source", `${path}.source`, "Unknown provenance source"));
  }

  for (const genre of scene.genres) {
    if (!isSceneGenre(genre)) {
      errors.push(issue("invalid_genre", `${path}.genres`, `Unknown genre ${genre}`));
    }
  }
  for (const trope of scene.tropes) {
    if (!isSceneTrope(trope)) {
      errors.push(issue("invalid_trope", `${path}.tropes`, `Unknown trope ${trope}`));
    }
  }
  if (scene.emotionalTone && !isEmotionalTone(scene.emotionalTone)) {
    errors.push(
      issue("invalid_tone", `${path}.emotionalTone`, "Unknown emotional tone"),
    );
  }
  if (scene.narrativeBeat && !isNarrativeBeat(scene.narrativeBeat)) {
    errors.push(
      issue("invalid_beat", `${path}.narrativeBeat`, "Unknown narrative beat"),
    );
  }

  for (const charId of scene.characterIds) {
    if (!characterIds.has(charId)) {
      errors.push(
        issue(
          "unknown_character",
          `${path}.characterIds`,
          `Unknown character ${charId}`,
        ),
      );
    }
  }
  if (scene.characterRoles) {
    for (const role of scene.characterRoles) {
      if (!isCharacterRole(role)) {
        errors.push(issue("invalid_role", `${path}.characterRoles`, `Unknown role ${role}`));
      }
    }
  }
  if (scene.relationshipIds) {
    for (const relId of scene.relationshipIds) {
      if (!relationshipIds.has(relId)) {
        errors.push(
          issue(
            "unknown_relationship",
            `${path}.relationshipIds`,
            `Unknown relationship ${relId}`,
          ),
        );
      }
    }
  }

  const intensityFields: (keyof SceneNode)[] = [
    "emotionalIntensity",
    "cliffhangerStrength",
    "importance",
    "dialogueDensity",
    "actionDensity",
    "romanceIntensity",
    "suspenseIntensity",
    "comedyIntensity",
    "hookStrength",
    "emotionalPeak",
    "surpriseStrength",
  ];
  for (const field of intensityFields) {
    const value = scene[field];
    if (typeof value === "number" && !intensityOk(value)) {
      errors.push(
        issue("invalid_intensity", `${path}.${String(field)}`, "Intensity must be 0–1"),
      );
    }
  }

  return errors;
}

/**
 * Validate a Scene Graph document.
 * Overlaps within an episode are rejected (adjacent end===next.start is allowed).
 */
export function validateSceneGraph(doc: SceneGraphDocument): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (doc.schemaVersion !== SCHEMA_VERSION) {
    errors.push(
      issue(
        "schema_version",
        "schemaVersion",
        `Expected schemaVersion ${SCHEMA_VERSION}`,
      ),
    );
  }

  const seriesIds = new Set(doc.series.map((s) => s.id));
  const episodeIds = new Set(doc.episodes.map((e) => e.id));
  const characterIds = new Set(doc.characters.map((c) => c.id));
  const relationshipIds = new Set(doc.relationships.map((r) => r.id));
  const sceneIds = new Set<string>();

  if (seriesIds.size !== doc.series.length) {
    errors.push(issue("duplicate_id", "series", "Duplicate series ids"));
  }
  if (episodeIds.size !== doc.episodes.length) {
    errors.push(issue("duplicate_id", "episodes", "Duplicate episode ids"));
  }
  if (characterIds.size !== doc.characters.length) {
    errors.push(issue("duplicate_id", "characters", "Duplicate character ids"));
  }

  for (const [i, episode] of doc.episodes.entries()) {
    if (!seriesIds.has(episode.seriesId)) {
      errors.push(
        issue(
          "unknown_series",
          `episodes[${i}].seriesId`,
          `Unknown series ${episode.seriesId}`,
        ),
      );
    }
  }

  for (const [i, character] of doc.characters.entries()) {
    if (!isCharacterRole(character.role)) {
      errors.push(
        issue("invalid_role", `characters[${i}].role`, "Unknown character role"),
      );
    }
  }

  for (const [i, rel] of doc.relationships.entries()) {
    if (!isRelationshipType(rel.type)) {
      errors.push(
        issue("invalid_relationship", `relationships[${i}].type`, "Unknown type"),
      );
    }
    if (!characterIds.has(rel.fromCharacterId)) {
      errors.push(
        issue(
          "unknown_character",
          `relationships[${i}].fromCharacterId`,
          "Unknown from character",
        ),
      );
    }
    if (!characterIds.has(rel.toCharacterId)) {
      errors.push(
        issue(
          "unknown_character",
          `relationships[${i}].toCharacterId`,
          "Unknown to character",
        ),
      );
    }
  }

  for (const [i, scene] of doc.scenes.entries()) {
    if (sceneIds.has(scene.id)) {
      errors.push(issue("duplicate_id", `scenes[${i}].id`, `Duplicate scene ${scene.id}`));
    }
    sceneIds.add(scene.id);
    errors.push(
      ...validateScene(scene, i, characterIds, episodeIds, seriesIds, relationshipIds),
    );
    if (scene.metadataConfidence < 0.4) {
      warnings.push(
        issue(
          "low_confidence",
          `scenes[${i}].metadataConfidence`,
          "Metadata confidence is low",
        ),
      );
    }
  }

  // Per-episode timing + sequence
  const byEpisode = new Map<string, SceneNode[]>();
  for (const scene of doc.scenes) {
    const list = byEpisode.get(scene.episodeId) ?? [];
    list.push(scene);
    byEpisode.set(scene.episodeId, list);
  }

  for (const [episodeId, scenes] of byEpisode) {
    const ordered = [...scenes].sort((a, b) => a.sequence - b.sequence);
    for (let i = 0; i < ordered.length; i += 1) {
      const scene = ordered[i]!;
      if (scene.sequence !== i) {
        // Allow non-zero-based if contiguous from min
        const minSeq = ordered[0]!.sequence;
        if (scene.sequence !== minSeq + i) {
          errors.push(
            issue(
              "invalid_sequence",
              `episode:${episodeId}`,
              `Scene sequence must be contiguous (got ${scene.sequence} at position ${i})`,
            ),
          );
        }
      }
      if (i > 0) {
        const prev = ordered[i - 1]!;
        if (scene.startMs < prev.endMs) {
          errors.push(
            issue(
              "overlap",
              `episode:${episodeId}`,
              `Scenes ${prev.id} and ${scene.id} overlap`,
            ),
          );
        }
      }
    }
  }

  // Episode sceneIds consistency (warning if empty episode)
  for (const episode of doc.episodes) {
    const scenes = byEpisode.get(episode.id) ?? [];
    if (scenes.length === 0) {
      warnings.push(
        issue("empty_episode", `episodes.${episode.id}`, "Episode has no scenes"),
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
