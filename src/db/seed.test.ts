import { describe, expect, it } from "vitest";
import { seedSampleData } from "./seed";

describe("seedSampleData", () => {
  it("seeds samples by default and skips them when SEED_SAMPLE_DATA=0", () => {
    expect(seedSampleData({})).toBe(true);
    expect(seedSampleData({ SEED_SAMPLE_DATA: "1" })).toBe(true);
    expect(seedSampleData({ SEED_SAMPLE_DATA: "0" })).toBe(false);
  });
});
