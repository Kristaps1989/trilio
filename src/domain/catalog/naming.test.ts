import { describe, expect, it } from "vitest";
import { displayName, nameHasType } from "./naming";

describe("displayName (§2.8: the name says what the product is)", () => {
  it("adds the type after the brand when the shop's name has none", () => {
    expect(displayName("Indesit C YSD 83D WW EE", "Indesit", "dryer", "veļas žāvētājs")).toBe(
      "Indesit veļas žāvētājs C YSD 83D WW EE",
    );
  });
  it("leaves names that already say it", () => {
    expect(nameHasType("Bomann KS 2194 kombinētais ledusskapis", "fridge")).toBe(true);
    expect(displayName("Beko ledusskapis RCSA", "Beko", "fridge", "ledusskapis")).toBe(
      "Beko ledusskapis RCSA",
    );
  });
});
