import { describe, expect, it } from "vitest";
import { guaranteeSheet, guaranteeText, sellerLine, type GuaranteeInput } from "./guarantee";

// The guarantee sheet of a final invoice (Consumer Rights Protection Law, Art. 13 and 16):
// what a private buyer, a buyer of a refurbished product and a business each read.

const base: GuaranteeInput = {
  buyerKind: "person",
  warrantyMonths: 24,
  grade: null,
  product: "Bosch SMS4HVI33E",
  orderNumber: "T-7K2M9Q",
  invoiceNumber: "TR-2026-0007",
  seller: "Sky Solutions SIA, Reģ. Nr. 40000000002, Rīga",
  email: "info@trilio.lv",
};
const headings = (input: GuaranteeInput, lang: "lv" | "en" = "lv") =>
  guaranteeSheet(input, lang).sections.map((s) => s.heading);

describe("guaranteeSheet", () => {
  it("a private buyer: legal rights, how to claim, withdrawal with its form, disputes", () => {
    const sheet = guaranteeSheet(base);
    expect(sheet.title).toBe("Garantija un tavas tiesības");
    expect(headings(base)).toEqual([
      null,
      "Likumā noteiktās tiesības (2 gadi)",
      "Kā pieteikt prasījumu",
      "Atteikuma tiesības (14 dienas)",
      "Atteikuma veidlapa",
      "Ja neizdodas vienoties",
    ]);
    const text = guaranteeText(sheet);
    expect(text).toContain("Prece: Bosch SMS4HVI33E. Pasūtījums T-7K2M9Q, rēķins TR-2026-0007.");
    expect(text).toContain("Pārdevējs: Sky Solutions SIA, Reģ. Nr. 40000000002, Rīga.");
    expect(text).toContain("norādi pasūtījuma numuru T-7K2M9Q");
    expect(text).toContain("Kam: Sky Solutions SIA");
    expect(text).not.toMatch(/\{\w+\}/);
    expect(text).not.toContain("Papildu garantija");
  });

  it("a longer guarantee from the offer is named as additional and leaves the legal rights untouched", () => {
    const sheet = guaranteeSheet({ ...base, warrantyMonths: 60 });
    const extra = sheet.sections.find((s) => s.heading === "Papildu garantija (60 mēn.)");
    expect(extra?.lines[0]).toContain("60 mēnešus no piegādes dienas");
    expect(extra?.lines[0]).toContain("Sky Solutions SIA");
    expect(extra?.lines.at(-1)).toContain("neietekmē tavas likumā noteiktās patērētāja tiesības");
  });

  it("a refurbished product names its condition grade", () => {
    const text = guaranteeText(guaranteeSheet({ ...base, grade: "A" }));
    expect(text).toContain("Prece ir atjaunota, stāvoklis: A.");
    expect(guaranteeText(guaranteeSheet(base))).not.toContain("atjaunota");
  });

  it("a business reads the offer's guarantee and that consumer rules do not apply", () => {
    const company = { ...base, buyerKind: "company" as const, warrantyMonths: 12 };
    const sheet = guaranteeSheet(company);
    expect(sheet.title).toBe("Garantijas noteikumi");
    const text = guaranteeText(sheet);
    expect(text).toContain("garantija 12 mēnešus no piegādes dienas");
    expect(text).toContain("14 dienu atteikuma tiesības šim pirkumam nav piemērojamas");
    expect(text).not.toContain("Atteikuma veidlapa");
    expect(guaranteeText(guaranteeSheet({ ...company, warrantyMonths: 0 }))).not.toContain("mēnešus");
  });

  it("reads in English too", () => {
    const text = guaranteeText(guaranteeSheet({ ...base, warrantyMonths: 36 }, "en"));
    expect(text).toContain("GUARANTEE AND YOUR RIGHTS");
    expect(text).toContain("Additional guarantee (36 months)");
    expect(text).toContain("Withdrawal form");
    expect(text).not.toMatch(/\{\w+\}/);
  });
});

describe("sellerLine", () => {
  it("joins what the invoice knows about the seller", () => {
    const seller = {
      name: "Sky Solutions SIA",
      regNo: "40000000002",
      address: "Rīga",
      email: "a@b.lv",
      vatNo: "",
    };
    expect(sellerLine(seller)).toBe("Sky Solutions SIA, Reģ. Nr. 40000000002, Rīga, a@b.lv");
    expect(sellerLine(seller, "en")).toBe("Sky Solutions SIA, Reg. No. 40000000002, Rīga, a@b.lv");
    expect(sellerLine({ name: "Trilio" })).toBe("Trilio");
    expect(sellerLine({ name: "", email: "a@b.lv" })).toBe("Trilio, a@b.lv");
  });
});
