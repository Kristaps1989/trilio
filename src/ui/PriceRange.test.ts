import { describe, expect, it } from "vitest";
import { typedLimit } from "./PriceRange";

// A typed price limit (owner, 18 Nov 2026: "8" on the way to "800" jumped to the lower limit):
// applied only when the field is left, kept between the cheapest and dearest product and the
// other limit, and ignored when it is not a number.

const scale = { lo: 47_000, top: 377_000 };
const range = { min: 47_000, max: 377_000 };

describe("typedLimit", () => {
  it("takes a typed upper limit as it is when it fits", () => {
    expect(typedLimit("max", "800", range, scale)).toEqual({ min: 47_000, max: 80_000 });
    expect(typedLimit("max", "1 200 €", range, scale)).toEqual({ min: 47_000, max: 120_000 });
    expect(typedLimit("min", "550,4", range, scale)).toEqual({ min: 55_000, max: 377_000 });
  });
  it("keeps the limits inside what is on offer and never crossed", () => {
    expect(typedLimit("min", "100", range, scale)).toEqual({ min: 47_000, max: 377_000 });
    expect(typedLimit("max", "9000", range, scale)).toEqual({ min: 47_000, max: 377_000 });
    expect(typedLimit("max", "300", { min: 60_000, max: 90_000 }, scale)).toEqual({
      min: 60_000,
      max: 60_000,
    });
    expect(typedLimit("min", "1000", { min: 60_000, max: 90_000 }, scale)).toEqual({
      min: 90_000,
      max: 90_000,
    });
  });
  it("ignores what is not a number", () => {
    expect(typedLimit("max", "", range, scale)).toBeNull();
    expect(typedLimit("max", "abc", range, scale)).toBeNull();
    expect(typedLimit("min", "-5", range, scale)).toBeNull();
  });
});
