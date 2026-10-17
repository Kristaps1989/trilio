import { describe, expect, it } from "vitest";
import type { ProductView } from "@/domain/catalog/types";
import { upgradeDelta } from "./delta";

function p(attributes: Record<string, unknown>, kwhYear: number | null = null): ProductView {
  return {
    id: "x",
    ean: null,
    brand: "B",
    modelCode: "M",
    name: "B M",
    subcategoryId: "fridge",
    attributes,
    tags: [],
    specs: null,
    kwhYear,
    rating: null,
    imageUrl: null,
    extractionConfidence: null,
    offers: [],
  };
}

describe("upgradeDelta", () => {
  it("lists gains first, then downsides, with the price difference", () => {
    const cheaper = {
      product: p({ volume_l: 300, noise_db: 42, energy_class: "E", no_frost: false }, 280),
      priceCents: 59900,
    };
    const pricier = {
      product: p({ volume_l: 348, noise_db: 38, energy_class: "D", no_frost: true }, 300),
      priceCents: 77900,
    };
    const d = upgradeDelta(cheaper, pricier, 25);
    expect(d.priceDeltaCents).toBe(18000);
    expect(d.onlyBrandAndDesign).toBe(false);
    expect(d.items).toEqual([
      { kind: "number", key: "volume_l", delta: 48, better: true },
      { kind: "number", key: "noise_db", delta: -4, better: true },
      { kind: "energy_class", from: "E", to: "D", better: true },
      { kind: "boolean", key: "no_frost", gained: true },
      { kind: "energy_cost", deltaCents: 5000, better: false }, // 300 vs 280 kWh → 750 € vs 700 €
    ]);
  });

  it("ignores differences below the noise floor and unknown attributes", () => {
    const d = upgradeDelta(
      { product: p({ volume_l: 300, noise_db: 40 }), priceCents: 1 },
      { product: p({ volume_l: 305, noise_db: 39, energy_class: "C" }), priceCents: 2 },
      25,
    );
    expect(d.items).toEqual([]);
    expect(d.onlyBrandAndDesign).toBe(true);
  });

  it("reports downsides honestly (louder, worse class, lost feature)", () => {
    const d = upgradeDelta(
      { product: p({ noise_db: 36, energy_class: "C", mop: true }), priceCents: 1 },
      { product: p({ noise_db: 41, energy_class: "E", mop: false }), priceCents: 2 },
      25,
    );
    expect(d.items.every((i) => (i.kind === "boolean" ? !i.gained : !i.better))).toBe(true);
    expect(d.items).toHaveLength(3);
  });
});
