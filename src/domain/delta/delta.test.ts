import { describe, expect, it } from "vitest";
import { getSubcategory } from "@/domain/questions/catalog";
import { product } from "@/domain/testing/builders";
import { upgradeDelta } from "./delta";

const dryer = getSubcategory("dryer")!;
const fridge = getSubcategory("fridge")!;
const at = (p: ReturnType<typeof product>, eur: number) => ({ product: p, priceCents: eur * 100 });

describe("upgradeDelta (§2.8: card text that is always true)", () => {
  it("the owner's screenshot: same brand, unknown specs → no claim at all", () => {
    const a = product({ name: "Indesit C YSD 83D WW EE", subcategoryId: "dryer" });
    const b = product({ name: "Indesit C YD 92D WB EE", subcategoryId: "dryer" });
    const d = upgradeDelta(at(a, 387), at(b, 396), 25, dryer.compare);
    expect(d.status).toBe("unknown");
    expect(d.brandsDiffer).toBe(false);
  });

  it("same brand, specs known and equal → 'only the price differs'", () => {
    const attrs = {
      dryer_type: "heatpump",
      capacity_kg: 8,
      energy_class: "A",
      noise_db: 64,
      stackable: true,
    };
    const a = product({ name: "Indesit A", attrs, subcategoryId: "dryer" });
    const b = product({ name: "Indesit B", attrs, subcategoryId: "dryer" });
    const d = upgradeDelta(at(a, 387), at(b, 396), 25, dryer.compare);
    expect(d).toMatchObject({ status: "same", brandsDiffer: false, items: [] });
  });

  it("different brands, specs known and equal → brand and design", () => {
    const attrs = {
      dryer_type: "heatpump",
      capacity_kg: 8,
      energy_class: "A",
      noise_db: 64,
      stackable: true,
    };
    const d = upgradeDelta(
      at(product({ name: "Beko A", attrs }), 400),
      at(product({ name: "Bosch B", attrs }), 450),
      25,
      dryer.compare,
    );
    expect(d).toMatchObject({ status: "same", brandsDiffer: true });
  });

  it("lists what differs in the category's own terms: capacity, type, energy", () => {
    const a = product({
      name: "Indesit A",
      attrs: { dryer_type: "condenser", capacity_kg: 8, energy_class: "B" },
    });
    const b = product({
      name: "Indesit B",
      attrs: { dryer_type: "heatpump", capacity_kg: 9, energy_class: "A" },
    });
    const d = upgradeDelta(at(a, 387), at(b, 396), 25, dryer.compare);
    expect(d.status).toBe("differs");
    expect(d.items).toEqual(
      expect.arrayContaining([
        { kind: "number", key: "capacity_kg", delta: 1, better: true },
        { kind: "energy_class", from: "B", to: "A", better: true },
        { kind: "enum", key: "dryer_type", from: "condenser", to: "heatpump" },
      ]),
    );
  });

  it("downsides come after gains; electricity over 10 years is included", () => {
    const a = product({ name: "A", attrs: { volume_l: 300, noise_db: 36, form: "combi" }, kwhYear: 150 });
    const b = product({ name: "B", attrs: { volume_l: 360, noise_db: 40, form: "combi" }, kwhYear: 250 });
    const d = upgradeDelta(at(a, 500), at(b, 680), 25, fridge.compare);
    expect(d.items[0]).toMatchObject({ kind: "number", key: "volume_l", better: true });
    expect(d.items.at(-1)).toMatchObject({ kind: "energy_cost", better: false, deltaCents: 25000 });
  });
});
