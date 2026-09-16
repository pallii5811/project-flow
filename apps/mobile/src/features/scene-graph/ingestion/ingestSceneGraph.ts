import type { SceneGraphDocument } from "../model/types";
import {
  validateSceneGraph,
  type ValidationResult,
} from "../validation/validateSceneGraph";

/**
 * Ingestion abstraction:
 * RawContent → SceneExtraction → MetadataExtraction → Validation → StoredSceneGraph
 *
 * V0 accepts a pre-authored document (fixtures). Future extractors plug in here.
 */
export type SceneGraphIngestResult =
  | { ok: true; document: SceneGraphDocument; validation: ValidationResult }
  | { ok: false; validation: ValidationResult };

export function ingestSceneGraphDocument(
  raw: SceneGraphDocument,
): SceneGraphIngestResult {
  const validation = validateSceneGraph(raw);
  if (!validation.ok) {
    return { ok: false, validation };
  }
  return { ok: true, document: raw, validation };
}
