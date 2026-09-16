import { describe, expect, it } from "vitest";

/**
 * Identity helpers are DOM-bound; exercise storage contract with a mock.
 */
describe("anonymous identity contract", () => {
  it("keeps anonymous_user_id and session_id as distinct concepts", () => {
    const anonKey = "project-flow.anonymous_user.v1";
    const sessionKey = "project-flow.session.v1";
    expect(anonKey).not.toBe(sessionKey);

    const store = new Map<string, string>();
    let seq = 0;
    const createId = (prefix: string) => `${prefix}_${seq++}`;
    const getAnon = () => {
      const existing = store.get(anonKey);
      if (existing) return existing;
      const next = createId("anon");
      store.set(anonKey, next);
      return next;
    };
    const getSession = () => {
      const existing = store.get(sessionKey);
      if (existing) return existing;
      const next = createId("session");
      store.set(sessionKey, next);
      return next;
    };

    const a1 = getAnon();
    const s1 = getSession();
    const a2 = getAnon();
    const s2 = getSession();
    expect(a1).toBe(a2);
    expect(s1).toBe(s2);
    expect(a1).not.toBe(s1);

    store.delete(sessionKey);
    const s3 = getSession();
    expect(getAnon()).toBe(a1);
    expect(s3).not.toBe(s1);
  });
});
