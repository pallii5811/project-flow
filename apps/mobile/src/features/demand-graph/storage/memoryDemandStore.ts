import type { DemandPatternRecord, DemandSignal } from "../model/types";

export type DemandGraphStore = {
  loadSignals(): Promise<DemandSignal[]>;
  loadPatterns(): Promise<DemandPatternRecord[]>;
  saveSignal(signal: DemandSignal): Promise<void>;
  savePattern(pattern: DemandPatternRecord): Promise<void>;
  getPattern(patternId: string): Promise<DemandPatternRecord | null>;
  hasDedupeKey(key: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
};

export function createMemoryDemandStore(): DemandGraphStore {
  const signals: DemandSignal[] = [];
  const patterns = new Map<string, DemandPatternRecord>();
  const dedupe = new Set<string>();

  return {
    async loadSignals() {
      return [...signals];
    },
    async loadPatterns() {
      return [...patterns.values()];
    },
    async saveSignal(signal) {
      signals.push(signal);
      dedupe.add(signal.dedupeKey);
    },
    async savePattern(pattern) {
      patterns.set(pattern.patternId, pattern);
    },
    async getPattern(patternId) {
      return patterns.get(patternId) ?? null;
    },
    async hasDedupeKey(key) {
      return dedupe.has(key);
    },
    async isAvailable() {
      return true;
    },
  };
}

export function createUnavailableDemandStore(): DemandGraphStore {
  return {
    async loadSignals() {
      return [];
    },
    async loadPatterns() {
      return [];
    },
    async saveSignal() {
      throw new Error("Demand Graph storage unavailable");
    },
    async savePattern() {
      throw new Error("Demand Graph storage unavailable");
    },
    async getPattern() {
      return null;
    },
    async hasDedupeKey() {
      return false;
    },
    async isAvailable() {
      return false;
    },
  };
}
