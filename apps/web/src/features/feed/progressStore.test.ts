import { describe, expect, it, vi } from "vitest";

import { createProgressStore, createStableHandlers } from "./progressStore";

describe("progress store", () => {
  it("notifies only the listeners of the episode that moved", () => {
    const store = createProgressStore();
    const first = vi.fn();
    const second = vi.fn();
    store.subscribe("a", first);
    store.subscribe("b", second);

    store.set("a", 0.25);
    expect(store.get("a")).toBe(0.25);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    // Same value: nothing re-renders.
    store.set("a", 0.25);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("clamps to 0..1 and reports 0 for an episode never played", () => {
    const store = createProgressStore();
    expect(store.get("never")).toBe(0);
    store.set("a", 1.4);
    expect(store.get("a")).toBe(1);
    store.set("a", Number.NaN);
    expect(store.get("a")).toBe(0);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createProgressStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe("a", listener);
    unsubscribe();
    store.set("a", 0.5);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("stable handlers", () => {
  it("keeps identity while calling the latest implementation", () => {
    const calls: string[] = [];
    const latest = {
      current: { onLike: (id: string) => calls.push(`old ${id}`) },
    };
    const stable = createStableHandlers(latest);
    const onLike = stable.onLike;

    latest.current = { onLike: (id: string) => calls.push(`new ${id}`) };
    expect(stable.onLike).toBe(onLike);
    stable.onLike("x");
    expect(calls).toEqual(["new x"]);
  });
});
