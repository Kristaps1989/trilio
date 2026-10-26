import { describe, expect, it } from "vitest";
import { decideLanding, landingCanonicalPath } from "./landing-index";

// docs/SEO_INDEXING_PLAN.md §2A: one address per distinct set of picks.

describe("decideLanding", () => {
  it("keeps a budget page with three picks of its own", () => {
    const d = decideLanding({
      base: ["a", "b", "c"],
      steps: [
        { eur: 500, ids: ["d", "e", "f"] },
        { eur: 800, ids: ["a", "e", "f"] },
      ],
    });
    expect(d).toEqual({ baseIndexed: true, canonicalOf: { 500: null, 800: null } });
  });
  it("folds a page that repeats the base page or a lower budget, in any order", () => {
    const d = decideLanding({
      base: ["a", "b", "c"],
      steps: [
        { eur: 800, ids: ["d", "e", "f"] },
        { eur: 500, ids: ["c", "b", "a"] },
        { eur: 1200, ids: ["f", "e", "d"] },
      ],
    });
    expect(d.canonicalOf).toEqual({ 500: 0, 800: null, 1200: 800 });
  });
  it("folds a thin page into the nearest page below that keeps its address", () => {
    const d = decideLanding({
      base: ["a", "b"],
      steps: [
        { eur: 50, ids: [] },
        { eur: 100, ids: ["a", "b", "x"] },
        { eur: 200, ids: ["y"] },
      ],
    });
    expect(d.canonicalOf).toEqual({ 50: 0, 100: null, 200: 100 });
    expect(d.baseIndexed).toBe(true);
  });
  it("marks an empty base page for noindex", () => {
    expect(decideLanding({ base: [], steps: [] }).baseIndexed).toBe(false);
  });
});

describe("landingCanonicalPath", () => {
  const d = { baseIndexed: true, canonicalOf: { 500: 0, 800: null, 1200: 800 } };
  it("names the page itself, or the page it repeats", () => {
    expect(landingCanonicalPath("fridge", null, d)).toBe("/kategorija/fridge");
    expect(landingCanonicalPath("fridge", 800, d)).toBe("/kategorija/fridge/lidz-800");
    expect(landingCanonicalPath("fridge", 500, d)).toBe("/kategorija/fridge");
    expect(landingCanonicalPath("fridge", 1200, d)).toBe("/kategorija/fridge/lidz-800");
    expect(landingCanonicalPath("fridge", 700, null)).toBe("/kategorija/fridge/lidz-700");
  });
});
