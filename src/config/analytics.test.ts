import { describe, expect, it } from "vitest";
import { analyticsId } from "./analytics";

describe("analyticsId", () => {
  it("accepts GA4 ids and ignores anything else", () => {
    expect(analyticsId({ GA_MEASUREMENT_ID: " G-ABC123XYZ " })).toBe("G-ABC123XYZ");
    expect(analyticsId({})).toBeNull();
    expect(analyticsId({ GA_MEASUREMENT_ID: "UA-1234-1" })).toBeNull();
    expect(analyticsId({ GA_MEASUREMENT_ID: "G-<script>" })).toBeNull();
  });
});
