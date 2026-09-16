/**
 * Playback progress lives outside React state (speed-5).
 *
 * The video reports its position about four times a second. Kept in the feed's
 * state, every report re-rendered the whole feed; here it only notifies the
 * one progress bar that listens to that episode.
 */
export type ProgressStore = {
  /** Fraction watched, 0..1; 0 for an episode never reported. */
  get(contentId: string): number;
  set(contentId: string, progress: number): void;
  subscribe(contentId: string, listener: () => void): () => void;
};

export function createProgressStore(): ProgressStore {
  const values = new Map<string, number>();
  const listeners = new Map<string, Set<() => void>>();

  return {
    get(contentId) {
      return values.get(contentId) ?? 0;
    },
    set(contentId, progress) {
      const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
      if (values.get(contentId) === clamped) return;
      values.set(contentId, clamped);
      for (const listener of listeners.get(contentId) ?? []) listener();
    },
    subscribe(contentId, listener) {
      let set = listeners.get(contentId);
      if (!set) {
        set = new Set();
        listeners.set(contentId, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(contentId);
      };
    },
  };
}

/**
 * One object whose methods never change identity, each calling the latest
 * version of the handler. Slides receive it instead of fresh closures on every
 * render, so a memoized slide re-renders only when its own data changes.
 */
export function createStableHandlers<T extends object>(latest: { current: T }): T {
  const stable = {} as Record<string, unknown>;
  for (const key of Object.keys(latest.current)) {
    stable[key] = (...args: unknown[]) => {
      const handler = (latest.current as Record<string, unknown>)[key];
      if (typeof handler === "function") return handler(...args);
      return undefined;
    };
  }
  return stable as T;
}
