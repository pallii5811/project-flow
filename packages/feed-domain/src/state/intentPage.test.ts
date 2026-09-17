import { describe, expect, it } from "vitest";

import { applyIntentPage, getLaunchFeedCatalog, type ContentItem } from "../index";

const base = getLaunchFeedCatalog().items[0]!;
const make = (id: string): ContentItem => ({ ...base, id });
const ids = (items: ContentItem[]) => items.map((item) => item.id);

describe("applyIntentPage (R2)", () => {
  const listed = ["a", "b", "c", "d"].map(make);

  it("puts the chip's results right after the episode on screen", () => {
    expect(ids(applyIntentPage(listed, "b", [make("x"), make("c")]))).toEqual([
      "b",
      "x",
      "c",
      "d",
    ]);
  });

  it("follows the episode by id when the viewer moved during the fetch", () => {
    // Tapped on "a", auto-continue moved to "c" before the results arrived.
    expect(ids(applyIntentPage(listed, "c", [make("x")]))).toEqual(["c", "x", "d"]);
  });

  it("leaves the list alone when the episode is no longer listed", () => {
    expect(applyIntentPage(listed, "gone", [make("x")])).toBe(listed);
  });
});
