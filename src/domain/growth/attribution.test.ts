import { describe, expect, it } from "vitest";
import { adParams } from "./attribution";

describe("adParams", () => {
  it("keeps Google's click id and clean campaign tags", () => {
    expect(
      adParams({
        gclid: "Cj0KCQjw-abc_123",
        utm_source: "Google",
        utm_medium: "cpc",
        utm_campaign: "Dzesēšana",
      }),
    ).toEqual({
      gclid: "Cj0KCQjw-abc_123",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "dzesēšana",
      utmTerm: null,
    });
  });
  it("ignores visits that did not come from an ad, and junk values", () => {
    expect(adParams({})).toBeNull();
    expect(adParams({ utm_term: "ledusskapis" })).toBeNull();
    expect(adParams({ gclid: "<script>" })).toBeNull();
    expect(adParams({ gclid: "ok-click-id", utm_campaign: "a".repeat(300) })?.utmCampaign).toBeNull();
  });
});
