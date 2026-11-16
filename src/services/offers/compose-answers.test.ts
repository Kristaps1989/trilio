import { describe, expect, it } from "vitest";
import { composeAskEmail, composeNothingEmail } from "./compose-answers";
import { composeOfferEmail, offerPictures, type OfferDraft } from "./compose";
import { comparisonWords } from "./alternative";
import { compareProducts } from "@/domain/offers/alternative";

// The answers that are not an offer for the product asked for (docs/ALTERNATIVE_OFFER_PLAN.md §4):
// in both languages, for a request and for a plain save, with and without the dates and prices.

const ctx = {
  baseUrl: "https://trilio.test",
  signature: "Trilio",
  inbox: "info@trilio.test",
  company: "SIA Trilio",
  to: "x@example.invalid",
  askedName: "Bosch WGG24409BY Series 6, 8 kg, balta - Veļas mašīna",
};

describe("nothing to offer", () => {
  it("names the request, the shop price and how long the price is followed", () => {
    const m = composeNothingEmail({
      ...ctx,
      requestedAt: new Date("2026-11-12T10:00:00Z"),
      watchUntil: new Date("2027-02-10T10:00:00Z"),
      shopCents: 59_900,
      unsubscribeUrl: "https://trilio.test/piedavajumi/atteikties/t",
    });
    expect(m.subject).toMatch(/šobrīd nevaram piedāvāt lētāk/);
    expect(m.text).toMatch(/12\. novembrī pieprasīji/);
    expect(m.text).toMatch(/Veikalos šobrīd no 599/);
    expect(m.text).toMatch(/līdz trešdienai/);
    expect(m.headers?.["List-Unsubscribe"]).toContain("/api/offers/unsubscribe/t");
    expect(m.replyTo).toBe("info@trilio.test");
    expect(m.text).toContain("Trilio komanda");
  });
  it("works for a plain save in English, with no price and no end date", () => {
    const m = composeNothingEmail({
      ...ctx,
      lang: "en",
      requestedAt: null,
      watchUntil: null,
      shopCents: null,
    });
    expect(m.subject).toMatch(/can't offer it cheaper/);
    expect(m.text).toContain("You saved");
    expect(m.text).toContain("We keep following the price. If it drops");
    expect(m.headers).toBeUndefined();
    expect(m.html).toContain('lang="en"');
  });
});

describe("asked first", () => {
  it("offers two answers and no offer link", () => {
    const m = composeAskEmail({
      ...ctx,
      requestedAt: null,
      watchUntil: new Date("2027-02-10T10:00:00Z"),
      yesUrl: "https://trilio.test/piedavajumi/alternativa/t?atbilde=ja",
      noUrl: "https://trilio.test/piedavajumi/alternativa/t?atbilde=ne",
    });
    expect(m.subject).toMatch(/Piedāvāt līdzvērtīgu\?/);
    expect(m.text).toContain("Tu saglabāji preci");
    expect(m.text).toContain("Jā, piedāvājiet: https://trilio.test/piedavajumi/alternativa/t?atbilde=ja");
    expect(m.text).not.toMatch(/\/piedavajums\//);
  });
  it("in English with no end date", () => {
    const m = composeAskEmail({
      ...ctx,
      lang: "en",
      signature: "Kristaps",
      requestedAt: new Date("2026-11-12T10:00:00Z"),
      watchUntil: null,
      yesUrl: "https://y",
      noUrl: "https://n",
      unsubscribeUrl: "https://trilio.test/en/piedavajumi/atteikties/t",
    });
    expect(m.subject).toMatch(/Offer an equivalent\?/);
    expect(m.text).toContain("Kristaps, Trilio");
    expect(m.headers?.["List-Unsubscribe"]).toContain("/api/offers/unsubscribe/t");
  });
});

describe("the alternative offer", () => {
  const draft = (over: Partial<OfferDraft> = {}): OfferDraft => ({
    token: "tok",
    productName: "Electrolux EW7F249PS, 9 kg",
    priceCents: 54_900,
    deliveryWorkingDays: 1,
    referencePriceCents: null,
    referenceLow30Cents: null,
    condition: "refurbished",
    grade: "A",
    warrantyMonths: 12,
    message: "Sveiki!",
    validUntil: new Date("2026-11-23T20:00:00Z"),
    ...over,
  });
  const lines = compareProducts(
    { capacity_kg: 8, noise_db: 70, loading: "front" },
    { capacity_kg: 8, noise_db: 70, loading: "front" },
    ["capacity_kg", "noise_db", "loading"],
    "washer",
  );
  it("an equivalent one in English, refurbished, without shop prices or an end date", () => {
    const words = comparisonWords({ label: lines.label, lines: lines.lines }, "washer", "en");
    const m = composeOfferEmail(
      draft({
        alternative: {
          askedName: ctx.askedName,
          equivalent: true,
          ...words,
          originalSeenCents: null,
          requestedAt: null,
          declineUrl: "https://trilio.test/en/piedavajums/tok/atteikt",
          watchUntil: null,
        },
      }),
      { ...ctx, lang: "en", saved: null, now: new Date("2026-11-16T10:00:00Z") },
    );
    expect(m.subject).toMatch(/is unavailable — we can offer/);
    expect(m.text).toContain("Your model is unavailable. There is an equivalent alternative.");
    expect(m.text).toContain("Equivalent: it is not worse");
    expect(m.text).toContain("You saved");
    expect(m.text).toContain("Sveiki!");
    expect(m.headers).toBeUndefined();
  });
  it("uses the admin's pictures first, and the catalogue picture otherwise", () => {
    expect(
      offerPictures("https://t", { imageUrl: "/a.png", imageUrls: ["/api/offer-images/x.jpg"] }),
    ).toEqual(["https://t/api/offer-images/x.jpg"]);
    expect(offerPictures("https://t", { imageUrl: "/a.png" })).toEqual(["https://t/a.png"]);
    expect(offerPictures("https://t", { imageUrl: null })).toEqual([]);
  });
  it("names unknown and different lines as downsides in the reader's words", () => {
    const c = compareProducts(
      { capacity_kg: 8, loading: "front", noise_db: 70 },
      { capacity_kg: 7, loading: "top" },
      ["capacity_kg", "loading", "noise_db"],
      "washer",
    );
    const lv = comparisonWords({ label: c.label, lines: c.lines }, "washer", "lv");
    expect(lv.downsides.join("; ")).toMatch(/sliktāk.*citādi.*nav datu/);
    expect(lv.rows.map((r) => r.verdict?.tone)).toEqual(["bad", "bad", "none"]);
    const en = comparisonWords({ label: c.label, lines: c.lines }, "washer", "en");
    expect(en.downsides.join("; ")).toMatch(/worse.*different.*no data/);
  });
});
