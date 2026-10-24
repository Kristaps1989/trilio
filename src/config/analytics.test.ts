import { describe, expect, it } from "vitest";
import { adsConversionFor, adsTag, adsTagId, analyticsId, trackingEnabled, trackingHosts } from "./analytics";

describe("analyticsId", () => {
  it("accepts GA4 ids and ignores anything else", () => {
    expect(analyticsId({ GA_MEASUREMENT_ID: " G-ABC123XYZ " })).toBe("G-ABC123XYZ");
    expect(analyticsId({})).toBeNull();
    expect(analyticsId({ GA_MEASUREMENT_ID: "UA-1234-1" })).toBeNull();
    expect(analyticsId({ GA_MEASUREMENT_ID: "G-<script>" })).toBeNull();
  });
});

describe("Google Ads tag", () => {
  it("accepts only an AW- id and completes bare conversion labels", () => {
    expect(adsTagId({ GOOGLE_ADS_TAG_ID: " AW-18535248572 " })).toBe("AW-18535248572");
    expect(adsTagId({ GOOGLE_ADS_TAG_ID: "AW-<script>" })).toBeNull();
    expect(adsTag({})).toBeNull();
    const tag = adsTag({
      GOOGLE_ADS_TAG_ID: "AW-18535248572",
      GOOGLE_ADS_CONVERSION_SHOP_CLICK: "AbC-123_x",
      GOOGLE_ADS_CONVERSION_SAVE: "AW-18535248572/SaveLabel1",
    })!;
    expect(tag).toEqual({
      id: "AW-18535248572",
      shopClick: "AW-18535248572/AbC-123_x",
      save: "AW-18535248572/SaveLabel1",
    });
    expect(
      adsTag({ GOOGLE_ADS_TAG_ID: "AW-18535248572", GOOGLE_ADS_CONVERSION_SAVE: "bad label!" })!.save,
    ).toBeNull();
  });

  it("maps a shop click and a save to their conversions, nothing else", () => {
    const tag = adsTag({ GOOGLE_ADS_TAG_ID: "AW-123456789", GOOGLE_ADS_CONVERSION_SHOP_CLICK: "click1" })!;
    expect(adsConversionFor("select_offer", tag)).toBe("AW-123456789/click1");
    expect(adsConversionFor("save_item", tag)).toBeNull();
    expect(adsConversionFor("ui_click", tag)).toBeNull();
    expect(adsConversionFor("select_offer", null)).toBeNull();
  });

  it("turns the banner and the CSP hosts on for either tag", () => {
    expect(trackingEnabled({})).toBe(false);
    expect(trackingEnabled({ GOOGLE_ADS_TAG_ID: "AW-123456789" })).toBe(true);
    expect(trackingHosts({ GOOGLE_ADS_TAG_ID: "AW-123456789" })).toContain(
      "https://www.googleadservices.com",
    );
    const both = trackingHosts({ GOOGLE_ADS_TAG_ID: "AW-123456789", GA_MEASUREMENT_ID: "G-ABC123XYZ" });
    expect(both.filter((h) => h === "https://www.googletagmanager.com")).toHaveLength(1);
  });
});
