import { describe, expect, it } from "vitest";

import { classifySeriesEnd, finishedLastEpisode, isLastEpisode } from "./seriesEnd";

describe("series end (MP-7)", () => {
  it("is complete only after the last episode", () => {
    expect(classifySeriesEnd(5, 5)).toBe("series_complete");
    expect(classifySeriesEnd(3, 5)).toBe("series_unavailable_next");
  });

  it("an unknown episode count never claims completion", () => {
    expect(isLastEpisode(5, null)).toBe(false);
    expect(classifySeriesEnd(5, 0)).toBe("series_unavailable_next");
  });

  it("a swipe away from the last episode counts once nearly all of it was watched", () => {
    expect(finishedLastEpisode(5, 5, 0.96)).toBe(true);
    expect(finishedLastEpisode(5, 5, 0.5)).toBe(false);
    expect(finishedLastEpisode(4, 5, 1)).toBe(false);
  });
});
