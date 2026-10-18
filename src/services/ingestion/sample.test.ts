import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allSubcategories } from "@/domain/questions/catalog";
import { sampleAdapter } from "./sample";

const body = readFileSync("data/sample-products.json", "utf8");

describe("sampleAdapter", () => {
  const a = sampleAdapter.parse(body, { slug: "store_a" });
  const all = ["store_a", "store_b", "store_c"].flatMap((slug) => sampleAdapter.parse(body, { slug }).offers);

  it("rejects nothing from the shipped sample file", () => {
    expect(a.rejected).toEqual([]);
  });

  it("emits one row per offer of the requested store, skipping priceless out-of-stock rows", () => {
    expect(a.offers.length).toBeGreaterThan(100);
    expect(a.offers.every((o) => o.priceCents > 0)).toBe(true);
    const none = sampleAdapter.parse(body, { slug: "store_zzz" });
    expect(none.offers).toEqual([]);
  });

  it("passes a fridge's attributes through in the catalogue vocabulary", () => {
    const bosch = all.find((o) => o.modelCode === "KGN39VLCT" && o.condition === "new")!;
    expect(bosch.subcategoryId).toBe("fridge");
    expect(bosch.ean).toBe("4003174289161");
    expect(bosch.brand).toBe("Bosch");
    expect(bosch.attributes).toMatchObject({
      form: "combi",
      height_cm: 203,
      volume_l: 363,
      energy_class: "E",
      no_frost: true,
    });
    expect(bosch.rating).toBe(88);
  });

  it("covers every subcategory in categories.json", () => {
    const subs = new Set(all.map((o) => o.subcategoryId));
    for (const s of allSubcategories()) expect(subs, s.id).toContain(s.id);
  });

  it("turns refurbished entries into refurbished offers with grade and warranty", () => {
    const refurb = all.filter((o) => o.condition === "refurbished");
    expect(refurb.length).toBeGreaterThan(0);
    const one = refurb.find((o) => o.modelCode === "KGN39VLCT")!;
    expect(one.grade).toMatch(/^A/);
    expect(one.warrantyMonths).toBe(12);
    // Shares the EAN with the new product so they resolve to the same product row.
    expect(all.some((o) => o.ean === one.ean && o.condition === "new")).toBe(true);
  });
});
