import en from "@/i18n/messages/en.json";
import lv from "@/i18n/messages/lv.json";
import type { UiLocale } from "@/i18n/routing";
import { guaranteeTerms, type BuyerKind } from "@/domain/offers/offers";
import { fill } from "./texts";

// The guarantee sheet that goes with every final invoice, on the invoice page
// and in the "paid" e-mail (a durable medium, given before delivery: Consumer
// Rights Protection Law, Art. 16). A private buyer reads the legal two years,
// any longer guarantee from the offer, how to claim, the 14-day withdrawal with
// its form, and where to turn in a dispute. A business reads what the offer
// promised. Pure: the same sections make the page and the e-mail.

export type GuaranteeInput = {
  buyerKind: BuyerKind;
  warrantyMonths: number;
  /** A refurbished product's condition grade; null for a new one. */
  grade: string | null;
  product: string;
  orderNumber: string;
  invoiceNumber: string;
  /** "Sky Solutions SIA, Reģ. Nr. …, address, e-mail": whoever the invoice names as the seller. */
  seller: string;
  /** Where claims and withdrawals are sent. */
  email: string;
};

export type GuaranteeSection = { heading: string | null; lines: string[] };
export type GuaranteeSheet = { title: string; sections: GuaranteeSection[] };

export function guaranteeCopyFor(lang: UiLocale = "lv"): typeof lv.guarantee {
  return lang === "en" ? en.guarantee : lv.guarantee;
}

export function guaranteeSheet(input: GuaranteeInput, lang: UiLocale = "lv"): GuaranteeSheet {
  const c = guaranteeCopyFor(lang);
  const terms = guaranteeTerms(input.buyerKind, input.warrantyMonths);
  const values = {
    product: input.product,
    order: input.orderNumber,
    invoice: input.invoiceNumber,
    seller: input.seller,
    email: input.email,
    grade: input.grade ?? "",
    months: terms.commercialMonths ?? 0,
  };
  const f = (text: string) => fill(text, values);
  const intro: GuaranteeSection = { heading: null, lines: [f(c.intro)] };

  if (terms.legalMonths === null) {
    return {
      title: c.titleCompany,
      sections: [
        intro,
        { heading: null, lines: [...(terms.commercialMonths ? [f(c.company1)] : []), c.company2] },
      ],
    };
  }
  const sections: GuaranteeSection[] = [
    intro,
    {
      heading: c.legalH,
      lines: [c.legal1, c.legal2, c.legal3, ...(input.grade ? [f(c.refurbished)] : [])],
    },
  ];
  if (terms.commercialMonths)
    sections.push({ heading: f(c.commercialH), lines: [f(c.commercial1), c.commercial2, c.commercial3] });
  sections.push({ heading: c.claimH, lines: [f(c.claim1), c.claim2] });
  if (terms.withdrawal)
    sections.push(
      { heading: c.withdrawalH, lines: [f(c.withdrawal1), c.withdrawal2, c.withdrawal3] },
      { heading: c.formH, lines: [c.form1, f(c.form2), f(c.form3), f(c.form4), c.form5, c.form6] },
    );
  sections.push({ heading: c.disputeH, lines: [f(c.dispute1)] });
  return { title: c.title, sections };
}

/** The sheet as plain text for an e-mail: the title, then each section under its heading. */
export function guaranteeText(sheet: GuaranteeSheet): string {
  return [
    sheet.title.toUpperCase(),
    ...sheet.sections.map((s) => [s.heading, ...s.lines].filter(Boolean).join("\n")),
  ].join("\n\n");
}

/** The seller as one line, from an invoice's own snapshot. */
export function sellerLine(seller: Record<string, string>, lang: UiLocale = "lv"): string {
  return [
    seller.name || "Trilio",
    seller.regNo ? `${lang === "en" ? "Reg. No." : "Reģ. Nr."} ${seller.regNo}` : "",
    seller.address,
    seller.email,
  ]
    .filter(Boolean)
    .join(", ");
}
