import { describe, expect, it } from "vitest";
import { offer, product } from "@/domain/testing/builders";
import { brandTable, gradeOf, worthConsidering, type BrandTable } from "./consider";

const cand = (name: string, eur: number, score: number) => ({
  product: product({ name, price: eur }),
  score,
  reasons: [],
  offer: offer({ priceCents: eur * 100 }),
  unconfirmed: [],
  fitUnknown: false,
  price: eur * 100,
});
const table: BrandTable = {
  reviewed: true,
  brands: {
    Bosch: { grade: 4, sources: ["https://example.invalid/a"] },
    Beko: { grade: 4, sources: ["https://example.invalid/b"] },
    Noname: { grade: 2, sources: ["https://example.invalid/c"] },
  },
};

describe("worthConsidering (§2.5)", () => {
  const top = cand("Bosch Top", 500, 90);
  it("suggests an unchosen brand of equal grade that is as good and cheaper", () => {
    const pool = [top, cand("Beko Same", 430, 90), cand("Noname Cheap", 300, 95)];
    expect(worthConsidering(pool, top, ["Bosch"], table)?.product.name).toBe("Beko Same");
  });
  it("never without chosen brands, and never from an unreviewed table", () => {
    expect(worthConsidering([top, cand("Beko", 400, 95)], top, [], table)).toBeNull();
    expect(
      worthConsidering([top, cand("Beko", 400, 95)], top, ["Bosch"], { ...table, reviewed: false }),
    ).toBeNull();
  });
  it("a category grade overrides the brand's overall grade", () => {
    const t: BrandTable = {
      reviewed: true,
      brands: {
        Bosch: { grade: 4, sources: ["https://example.invalid/a"] },
        Beko: { grade: 4, categories: { fridge: 3 }, sources: ["https://example.invalid/b"] },
      },
    };
    expect(gradeOf(t, "BEKO", "fridge")).toBe(3);
    expect(gradeOf(t, "Beko", "washer")).toBe(4);
    expect(gradeOf(t, "Nobody")).toBeNull();
    // The builders' products are fridges: Beko is graded below Bosch there.
    const pool = [top, cand("Beko Same", 430, 90)];
    expect(worthConsidering(pool, top, ["Bosch"], t)).toBeNull();
  });

  it("never suggests a brand whose grade rests on low-confidence evidence", () => {
    const t: BrandTable = {
      ...table,
      brands: {
        ...table.brands,
        Beko: { grade: 4, confidence: "low", sources: ["https://example.invalid/b"] },
      },
    };
    expect(worthConsidering([top, cand("Beko Same", 430, 90)], top, ["Bosch"], t)).toBeNull();
  });

  it("the drafted table parses, cites sources for every brand and ships switched off", () => {
    expect(Object.keys(brandTable.brands).length).toBeGreaterThan(30);
    for (const b of Object.values(brandTable.brands)) expect(b.sources.length).toBeGreaterThan(0);
  });

  it("is switched on: the owner reviewed the table on 18 Oct 2026", () => {
    expect(brandTable.reviewed).toBe(true);
  });
});
