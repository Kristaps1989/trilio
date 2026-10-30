import { describe, expect, it } from "vitest";
import { formatEur } from "@/i18n/format";
import {
  composeOfferEmail,
  emailImageUrl,
  isOne,
  signatureLine,
  subjectProductName,
  type OfferDraft,
} from "./compose";

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

describe("the offer e-mail reads as one clear offer", () => {
  const lv = (over: Partial<OfferDraft> = {}, extra: Partial<Parameters<typeof composeOfferEmail>[1]> = {}) =>
    composeOfferEmail(
      {
        ...offer,
        productName: "Bosch, Series 4, NoFrost, 321 L, augstums 186 cm, balta - Ledusskapis",
        priceCents: 67000,
        referencePriceCents: 71999,
        referenceLow30Cents: 71999,
        deliveryWorkingDays: 5,
        validUntil: new Date(2026, 10, 6, 22),
        ...over,
      },
      {
        ...ctx,
        signature: "Trilio",
        inbox: "info@trilio.test",
        saved: { at: new Date(2026, 9, 27), priceCents: 71999 },
        now: new Date(2026, 9, 30, 15),
        unsubscribeUrl: "https://trilio.test/piedavajumi/atteikties/u",
        ...extra,
      },
    );

  it("never says 'Trilio no Trilio' and drops the shop's trailing type word", () => {
    const m = lv();
    expect(m.subject).toBe(`Bosch, Series 4, NoFrost, 321 L par ${formatEur(67000)}. Lētāk nekā veikalos.`);
    expect(`${m.subject}\n${m.text}`).not.toMatch(/Trilio no Trilio|Trilio, Trilio|Ledusskapis|Varu/);
    expect(m.text).toContain("Bosch, Series 4, NoFrost, 321 L, augstums 186 cm, balta\n");
    expect(m.text).toContain("Trilio komanda");
  });

  it("leads with the saving, then the price, delivery, warranty and validity, in Latvian", () => {
    const m = lv();
    expect(m.text.split("\n\n")[0]).toBe(`Tā pati prece. Par ${formatEur(4999)} mazāk.`);
    expect(m.text).toContain(`Veikalos šobrīd no ${formatEur(71999)}`);
    expect(m.text).toContain(`Par ${formatEur(4999)} lētāk nekā zemākā cena veikalos pēdējās 30 dienās`);
    expect(m.text).toContain("Tu to saglabāji 27. oktobrī, kad tā maksāja");
    expect(m.text).toContain("Bezmaksas piegāde visā Latvijā");
    expect(m.text).toContain(
      "Pie tevis 5 darba dienu laikā pēc apmaksas. Ja apmaksā šodien, saņemsi līdz piektdienai, 6. novembrim.",
    );
    expect(m.text).toContain("Garantija 24 mēn.");
    expect(m.text).toContain("Piedāvājums spēkā līdz piektdienai, 6. novembrim.");
    expect(m.replyTo).toBe("info@trilio.test");
  });

  it("is branded HTML: logo, picture through the site's image service, one lime button", () => {
    const m = lv({ imageUrl: "https://img.shop.test/a.jpg" });
    expect(m.html).toContain('src="https://trilio.test/email/logo.png"');
    expect(m.html).toContain(
      `src="https://trilio.test/_next/image?url=${encodeURIComponent("https://img.shop.test/a.jpg")}&amp;w=256&amp;q=80"`,
    );
    expect(m.html!.match(/background:#D8F45A"><a href=/g)).toHaveLength(1);
    expect(m.html).toContain(`Pasūtīt par ${formatEur(67000)}`);
    expect(m.html).toContain('href="https://trilio.test/piedavajumi/atteikties/u"');
    expect(m.html).not.toContain("<script");
  });

  it("without a saving it claims none; one working day is singular; refurbished shows its grade", () => {
    const m = lv(
      {
        referenceLow30Cents: 60000,
        referencePriceCents: 60000,
        deliveryWorkingDays: 1,
        condition: "refurbished",
        grade: "A",
        warrantyMonths: 12,
      },
      { saved: null },
    );
    expect(m.subject).toBe(`Bosch, Series 4, NoFrost, 321 L par ${formatEur(67000)}`);
    expect(m.text).not.toMatch(/lētāk|mazāk\./);
    expect(m.text).toContain(`Tava saglabātā prece. Tagad par ${formatEur(67000)}.`);
    expect(m.text).toContain("Pie tevis 1 darba dienas laikā");
    expect(m.text).toContain("Atjaunota prece, stāvoklis: A");
    expect(m.text).toContain("Garantija 12 mēn.");
  });

  it("escapes the admin's own note in the HTML", () => {
    const m = lv({ message: "<b>Tikko</b> atvests & gatavs" });
    expect(m.html).toContain("&lt;b&gt;Tikko&lt;/b&gt; atvests &amp; gatavs");
  });
});

describe("e-mail helpers", () => {
  it("shortens long names at a comma for the subject", () => {
    expect(subjectProductName("Bosch KGN39 - Ledusskapis")).toBe("Bosch KGN39");
    expect(subjectProductName("A, " + "b".repeat(80))).toBe("A");
    expect(subjectProductName("x".repeat(90))).toBe(`${"x".repeat(40)}…`);
  });
  it("Latvian singular follows the last digit, except 11", () => {
    expect([1, 2, 11, 21, 111].map((n) => isOne(n, "lv"))).toEqual([true, false, false, true, false]);
    expect([1, 21].map((n) => isOne(n, "en"))).toEqual([true, false]);
  });
  it("signs as a person or as the team", () => {
    expect(signatureLine("Kristaps", "lv")).toBe("Kristaps, Trilio");
    expect(signatureLine("trilio", "lv")).toBe("Trilio komanda");
    expect(signatureLine("", "en")).toBe("The Trilio team");
  });
  it("loads pictures only from https or the site itself", () => {
    expect(emailImageUrl("https://t.test", "/sample/a.png")).toBe("https://t.test/sample/a.png");
    expect(emailImageUrl("https://t.test", "http://x.test/a.png")).toBeNull();
    expect(emailImageUrl("https://t.test", null)).toBeNull();
  });
});
