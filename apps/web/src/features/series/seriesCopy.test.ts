import { describe, expect, it } from "vitest";

import {
  continueLabel,
  continuePoint,
  episodeCountLine,
  episodeLength,
  runtimeLine,
} from "./seriesCopy";

const EPISODES = [
  { contentId: "item_signal_1", episodeNumber: 1 },
  { contentId: "item_signal_2", episodeNumber: 2 },
  { contentId: "item_signal_3", episodeNumber: 3 },
];

describe("episodeCountLine", () => {
  it("counts in the words a viewer would use", () => {
    expect(episodeCountLine(1)).toBe("1 episode");
    expect(episodeCountLine(60)).toBe("60 episodes");
  });
});

describe("runtimeLine", () => {
  it("says nothing rather than 0 min", () => {
    // The stand-in pack is five ten-second episodes: under a minute.
    expect(runtimeLine(50_000)).toBeNull();
    expect(runtimeLine(0)).toBeNull();
    expect(runtimeLine(Number.NaN)).toBeNull();
  });

  it("reads minutes, then hours", () => {
    expect(runtimeLine(90_000)).toBe("2 min");
    expect(runtimeLine(45 * 60_000)).toBe("45 min");
    expect(runtimeLine(60 * 60_000)).toBe("1 h");
    expect(runtimeLine(95 * 60_000)).toBe("1 h 35 min");
  });
});

describe("episodeLength", () => {
  it("writes what a player writes", () => {
    expect(episodeLength(10_000)).toBe("0:10");
    expect(episodeLength(65_400)).toBe("1:05");
    expect(episodeLength(0)).toBeNull();
  });
});

describe("continuePoint", () => {
  it("sends a half-watched episode back to itself", () => {
    expect(
      continuePoint({ contentId: "item_signal_2", completed: false }, EPISODES),
    ).toEqual({ kind: "resume", episodeNumber: 2 });
  });

  it("sends a finished episode to the next one", () => {
    expect(
      continuePoint({ contentId: "item_signal_2", completed: true }, EPISODES),
    ).toEqual({ kind: "next", episodeNumber: 3 });
  });

  it("offers nothing after the last episode, instead of inventing one", () => {
    expect(
      continuePoint({ contentId: "item_signal_3", completed: true }, EPISODES),
    ).toBeNull();
  });

  it("offers nothing for an episode this build does not carry", () => {
    expect(
      continuePoint({ contentId: "item_gone", completed: false }, EPISODES),
    ).toBeNull();
    expect(continuePoint(null, EPISODES)).toBeNull();
  });
});

describe("continueLabel", () => {
  it("says which episode, never just Continue", () => {
    expect(continueLabel({ kind: "resume", episodeNumber: 3 })).toBe("Continue episode 3");
    expect(continueLabel({ kind: "next", episodeNumber: 4 })).toBe("Next: episode 4");
  });
});
