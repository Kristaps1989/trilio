import { describe, expect, it } from "vitest";
import { offer, product } from "@/domain/testing/builders";
import { brandTable, worthConsidering, type BrandTable } from "./consider";

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
  it("ships switched off until the owner reviews the drafted table", () => {
    expect(brandTable.reviewed).toBe(false);
  });
});
