import { describe, expect, it } from "vitest";

import { darkTheme, spacing } from "@project-flow/design-system";

import * as ui from "../src/index";

describe("ui package", () => {
  it("exports foundational primitives", () => {
    expect(typeof ui.Box).toBe("function");
    expect(typeof ui.Stack).toBe("function");
    expect(typeof ui.Row).toBe("function");
    expect(typeof ui.Text).toBe("function");
    expect(typeof ui.Icon).toBe("function");
    expect(typeof ui.Pressable).toBe("function");
    expect(typeof ui.Divider).toBe("function");
    expect(typeof ui.Spacer).toBe("function");
    expect(typeof ui.Surface).toBe("function");
    expect(typeof ui.GradientOverlay).toBe("function");
    expect(typeof ui.SafeArea).toBe("function");
    expect(typeof ui.Screen).toBe("function");
    expect(typeof ui.ThemeProvider).toBe("function");
    expect(typeof ui.useTheme).toBe("function");
  });

  it("keeps theme defaults aligned with design-system dark", () => {
    expect(darkTheme.spacing.md).toBe(spacing.md);
    expect(ui.uiFoundation.packageName).toBe("@project-flow/ui");
  });
});
