import { describe, expect, it } from "vitest";
import { searchWords } from "./catalog";

describe("searchWords", () => {
  it("splits a search into words matched independently of order", () => {
    expect(searchWords("  Airfryer   Philips ")).toEqual(["Airfryer", "Philips"]);
  });
  it("drops one-letter words and caps the count", () => {
    expect(searchWords("a Bosch")).toEqual(["Bosch"]);
    expect(searchWords("a1 b2 c3 d4 e5 f6 g7 h8 i9")).toHaveLength(8);
  });
  it("escapes LIKE wildcards", () => {
    expect(searchWords("50% off_x")).toEqual(["50\\%", "off\\_x"]);
  });
});
