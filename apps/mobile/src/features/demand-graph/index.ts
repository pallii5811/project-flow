export type {
  BehavioralEvidence,
  ConfidenceLevel,
  DemandGapKind,
  DemandLifecycleState,
  DemandPatternRecord,
  DemandQuery,
  DemandSignal,
  NormalizedDemandPattern,
  ProductionSignal,
} from "./model/types";
export {
  DEFAULT_DEMAND_THRESHOLDS,
  type DemandThresholds,
} from "./model/thresholds";
export {
  buildCanonicalKey,
  normalizeFromIntent,
  patternIdFromKey,
  patternsRelated,
} from "./normalize/normalizeDemand";
export { findClosestContent } from "./closest/findClosestContent";
export { buildProductionSignal } from "./producer/buildProductionSignal";
export {
  createDemandGraphService,
  hashAnonymousId,
  type DemandGraphService,
  type DemandIngestInput,
} from "./service/createDemandGraphService";
export {
  createMemoryDemandStore,
  createUnavailableDemandStore,
} from "./storage/memoryDemandStore";
export { DemandGraphInspector } from "./ui/DemandGraphInspector";
