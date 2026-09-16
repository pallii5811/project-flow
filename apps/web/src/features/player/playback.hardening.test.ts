import { describe, expect, it } from "vitest";

import { shouldShowPlayGate } from "../feed/feedLogic";

describe("playback product states", () => {
  it("autoplay blocked is a play gate, not an error", () => {
    expect(shouldShowPlayGate(true, false)).toBe(true);
    expect(shouldShowPlayGate(true, true)).toBe(false);
  });
});

describe("series_continue dedupe key", () => {
  it("emits once per from→to pair", () => {
    const seen = new Set<string>();
    const emit = (from: string, to: string) => {
      const key = `${from}->${to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    expect(emit("a", "b")).toBe(true);
    expect(emit("a", "b")).toBe(false);
    expect(emit("b", "c")).toBe(true);
  });
});
