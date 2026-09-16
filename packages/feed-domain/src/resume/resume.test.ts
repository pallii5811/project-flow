import { describe, expect, it } from "vitest";

import { isResumable, type ResumeSnapshot } from "./resumeStore";

const base: ResumeSnapshot = {
  contentId: "item_signal_1",
  seriesId: "series_signal",
  episodeId: "ep_signal_1",
  positionMs: 4000,
  durationMs: 10_000,
  muted: true,
  captionsOn: false,
  updatedAt: 1,
  completed: false,
};

describe("isResumable", () => {
  it("accepts mid-episode progress", () => {
    expect(isResumable(base)).toBe(true);
  });

  it("rejects near-end on short episodes (absolute remaining)", () => {
    expect(isResumable({ ...base, positionMs: 8800 })).toBe(false);
  });

  it("rejects high completion ratio", () => {
    expect(
      isResumable({ ...base, positionMs: 14_000, durationMs: 15_000 }),
    ).toBe(false);
  });
});
