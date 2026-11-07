import { describe, expect, it } from "vitest";
import { brandProfiles, companyFromEnv } from "@/config/company";
import { siteJsonLd } from "./site-jsonld";

describe("the brand's profiles", () => {
  it("keeps https addresses only, once each", () => {
    expect(
      brandProfiles({
        BRAND_PROFILES:
          "https://www.facebook.com/trilio.lv, https://www.instagram.com/trilio.lv/ http://x.lv nonsense https://www.facebook.com/trilio.lv",
      }),
    ).toEqual(["https://www.facebook.com/trilio.lv", "https://www.instagram.com/trilio.lv/"]);
    expect(brandProfiles({})).toEqual([]);
  });
});

describe("site structured data", () => {
  const base = "https://trilio.lv";
  it("names Trilio with its domain, legal name, country, contact and profiles; the site is published by it", () => {
    const [org, site] = siteJsonLd({
      base,
      inLanguage: "lv-LV",
      tagline: "Daži jautājumi. 3 ieteikumi.",
      description: "Sadzīves tehnikas pirkumu palīgs.",
      company: companyFromEnv({ COMPANY_NAME: "SIA Trilio", COMPANY_ADDRESS: "Rīga" }),
      profiles: ["https://www.facebook.com/trilio.lv"],
    }) as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(org).toMatchObject({
      "@type": "Organization",
      "@id": "https://trilio.lv/#organization",
      name: "Trilio",
      alternateName: ["trilio.lv"],
      legalName: "SIA Trilio",
      email: "info@trilio.lv",
      areaServed: { name: "Latvia" },
      address: { addressCountry: "LV" },
      sameAs: ["https://www.facebook.com/trilio.lv"],
    });
    expect(site).toMatchObject({
      "@type": "WebSite",
      alternateName: ["trilio.lv"],
      publisher: { "@id": "https://trilio.lv/#organization" },
    });
  });
  it("leaves out what is not configured", () => {
    const [org] = siteJsonLd({
      base,
      inLanguage: "lv-LV",
      tagline: "",
      description: "",
      company: companyFromEnv({}),
      profiles: [],
    }) as unknown as [Record<string, unknown>];
    expect(org).not.toHaveProperty("sameAs");
    expect(org).not.toHaveProperty("legalName");
    expect(org).not.toHaveProperty("address");
  });
});
