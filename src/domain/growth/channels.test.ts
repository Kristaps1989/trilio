import { describe, expect, it } from "vitest";
import { landingChannel, mixOf, TV_ELIGIBLE, visitorChannel, type LandingTags } from "./channels";

const tags = (t: Partial<LandingTags>): LandingTags => ({
  gclid: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  ...t,
});

describe("channels for TV measurement", () => {
  it("names each landing's channel from its tags", () => {
    expect(landingChannel(tags({ utmSource: "go3", utmMedium: "tv", utmCampaign: "casestudygo3" }))).toBe(
      "tv",
    );
    expect(landingChannel(tags({ gclid: "Cj0KCQiA1234567" }))).toBe("google");
    expect(landingChannel(tags({ gclid: "Cj0KCQiA1234567", utmTerm: "trilio" }))).toBe("google_brand");
    expect(landingChannel(tags({ utmSource: "google", utmMedium: "cpc", utmCampaign: "brand-trilio" }))).toBe(
      "google_brand",
    );
    expect(landingChannel(tags({ utmSource: "google", utmMedium: "cpc", utmCampaign: "ledusskapji" }))).toBe(
      "google",
    );
    expect(landingChannel(tags({ utmSource: "facebook", utmMedium: "paid" }))).toBe("meta_ads");
    expect(landingChannel(tags({ utmSource: "instagram", utmMedium: "cpc" }))).toBe("meta_ads");
    // Our own posts (utmLink) and organic Facebook clicks (fbclid).
    expect(landingChannel(tags({ utmSource: "facebook", utmMedium: "social" }))).toBe("social");
    expect(landingChannel(tags({ utmSource: "facebook", utmMedium: "fbclid" }))).toBe("social");
    expect(landingChannel(tags({ utmSource: "trilio", utmMedium: "email" }))).toBe("email");
    expect(landingChannel(tags({ utmSource: "partner", utmMedium: "referral" }))).toBe("other");
  });

  it("a visitor's day takes its first landing; without one it is direct", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 10, 9, 19, m));
    expect(visitorChannel([])).toBe("direct");
    expect(
      visitorChannel([
        { ...tags({ utmSource: "facebook", utmMedium: "paid" }), at: at(30) },
        { ...tags({ utmSource: "go3", utmMedium: "tv" }), at: at(5) },
      ]),
    ).toBe("tv");
  });

  it("TV is measured on what TV can cause", () => {
    expect([...TV_ELIGIBLE].sort()).toEqual(["direct", "google_brand", "tv"]);
    expect(mixOf(["direct", "direct", "google", "tv"])).toEqual({ direct: 2, google: 1, tv: 1 });
  });
});
