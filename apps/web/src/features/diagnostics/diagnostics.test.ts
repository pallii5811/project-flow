import { describe, expect, it } from "vitest";

import { isDiagEnabled } from "../../lib/session";

describe("diagnostics gate", () => {
  it("isDiagEnabled does not throw", () => {
    expect(typeof isDiagEnabled()).toBe("boolean");
  });
});
