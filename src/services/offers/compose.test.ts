import { describe, expect, it } from "vitest";
import { formatEur } from "@/i18n/format";
import { composeOfferEmail, type OfferDraft } from "./compose";

const offer: OfferDraft = {
  token: "tok",
  productName: "Bosch KGN39",
  priceCents: 59900,
  deliveryWorkingDays: 3,
  referencePriceCents: 64900,
  referenceLow30Cents: 62900,
  condition: "new",
  grade: null,
  warrantyMonths: 24,
  message: null,
  validUntil: new Date(2026, 10, 2),
};
const ctx = {
  baseUrl: "https://trilio.test",
  signature: "Kristaps",
  to: "a@example.invalid",
  saved: { at: new Date(2026, 9, 12), priceCents: 64900 },
  now: new Date(2026, 9, 26, 10),
};

describe("the offer e-mail in the reader's language", () => {
  it("is Latvian by default, with Latvian addresses", () => {
    const m = composeOfferEmail(offer, {
      ...ctx,
      unsubscribeUrl: "https://trilio.test/piedavajumi/atteikties/u",
    });
    expect(m.subject).toContain(formatEur(59900, "lv"));
    expect(m.text).toContain("https://trilio.test/piedavajums/tok");
    expect(m.headers?.["List-Unsubscribe"]).toBe("<https://trilio.test/api/offers/unsubscribe/u>");
  });

  it("is English for an English account: copy, formats and /en links", () => {
    const m = composeOfferEmail(offer, {
      ...ctx,
      lang: "en",
      unsubscribeUrl: "https://trilio.test/en/piedavajumi/atteikties/u",
    });
    expect(m.subject).toContain("€599");
    expect(m.text).toContain("https://trilio.test/en/piedavajums/tok");
    expect(m.text).toContain("12 October");
    // The one-click unsubscribe is an API address, the same in every language.
    expect(m.headers?.["List-Unsubscribe"]).toBe("<https://trilio.test/api/offers/unsubscribe/u>");
    expect(m.text).not.toBe(composeOfferEmail(offer, { ...ctx, unsubscribeUrl: "x" }).text);
  });
});
