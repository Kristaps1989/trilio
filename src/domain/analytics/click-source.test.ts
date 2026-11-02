import { describe, expect, it } from "vitest";
import { clickSource, withSource } from "./click-source";

describe("click source", () => {
  it("reads a known source, the older ask=1, and nothing else", () => {
    expect(clickSource(new URLSearchParams("from=note"))).toBe("note");
    expect(clickSource(new URLSearchParams("s=1&ask=1"))).toBe("ask");
    expect(clickSource(new URLSearchParams("from=evil"))).toBeNull();
    expect(clickSource(new URLSearchParams(""))).toBeNull();
  });
  it("adds the source to a link with or without a query", () => {
    expect(withSource("/go/a", "card")).toBe("/go/a?from=card");
    expect(withSource("/go/a?s=1", "newtab")).toBe("/go/a?s=1&from=newtab");
  });
});
