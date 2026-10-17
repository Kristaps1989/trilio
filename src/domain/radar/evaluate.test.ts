import { describe, expect, it } from "vitest";
import type { OfferView, ProductView } from "@/domain/catalog/types";
import { getSubcategory } from "@/domain/questions/catalog";
import { evaluateRadar, trackedOffer, type RadarSettings } from "./evaluate";

const fridge = getSubcategory("fridge")!;
let n = 0;
const offer = (o: Partial<OfferView>): OfferView => ({
  id: `o${++n}`,
  storeId: "s1",
  storeName: "A",
  condition: "new",
  grade: null,
  warrantyMonths: null,
  priceCents: 60000,
  stock: "in",
  deliveryEtaDays: null,
  storeDefaultDeliveryDays: 3,
  url: "https://x",
  lowest30dCents: null,
  ...o,
});
const product = (p: Partial<ProductView> & { id: string }): ProductView => ({
  ean: null,
  brand: "Bosch",
  modelCode: p.id,
  name: `Bosch ${p.id}`,
  subcategoryId: "fridge",
  attributes: { size_class: "tall" },
  tags: ["free", "tall", "yes"],
  specs: null,
  kwhYear: 200,
  rating: 80,
  imageUrl: null,
  extractionConfidence: null,
  offers: [offer({})],
  ...p,
});
const radar = (r: Partial<RadarSettings> = {}): RadarSettings => ({
  id: "r1",
  productId: "p1",
  threshold: "any",
  scope: "only",
  storeIds: [],
  includeRefurbished: false,
  baselinePriceCents: 60000,
  lastNotifiedAt: null,
  paused: false,
  answers: { type: "free", size: "tall", freezer: "yes" },
  ...r,
});
const cmp = { products: [] as ProductView[], sub: fridge, energyPriceCentsPerKwh: 25 };

describe("trackedOffer", () => {
  it("honours the store filter and the refurbished choice", () => {
    const p = product({
      id: "p1",
      offers: [
        offer({ storeId: "s1", priceCents: 60000 }),
        offer({ storeId: "s2", priceCents: 55000 }),
        offer({ storeId: "s2", priceCents: 40000, condition: "refurbished" }),
      ],
    });
    expect(trackedOffer(p, { storeIds: [], includeRefurbished: false })!.priceCents).toBe(55000);
    expect(trackedOffer(p, { storeIds: ["s1"], includeRefurbished: false })!.priceCents).toBe(60000);
    expect(trackedOffer(p, { storeIds: [], includeRefurbished: true })!.priceCents).toBe(40000);
  });
});

describe("evaluateRadar", () => {
  it("notifies on any drop, or only past the threshold", () => {
    const p = product({ id: "p1", offers: [offer({ priceCents: 57600 })] }); // −4 %
    expect(evaluateRadar(radar(), p, cmp)).toMatchObject([
      { kind: "drop", oldPriceCents: 60000, newPriceCents: 57600 },
    ]);
    expect(evaluateRadar(radar({ threshold: "5" }), p, cmp)).toEqual([]);
    const p10 = product({ id: "p1", offers: [offer({ priceCents: 54000 })] }); // −10 %
    expect(evaluateRadar(radar({ threshold: "10" }), p10, cmp)).toHaveLength(1);
    expect(
      evaluateRadar(
        radar({ threshold: "10" }),
        product({ id: "p1", offers: [offer({ priceCents: 54001 })] }),
        cmp,
      ),
    ).toEqual([]);
  });

  it("never notifies on a rise, when paused, without a baseline, or within the daily debounce", () => {
    const p = product({ id: "p1", offers: [offer({ priceCents: 50000 })] });
    expect(evaluateRadar(radar({ paused: true }), p, cmp)).toEqual([]);
    expect(evaluateRadar(radar({ baselinePriceCents: null }), p, cmp)).toEqual([]);
    expect(evaluateRadar(radar({ baselinePriceCents: 45000 }), p, cmp)).toEqual([]);
    const now = new Date("2026-11-01T12:00:00Z");
    expect(evaluateRadar(radar({ lastNotifiedAt: new Date("2026-11-01T00:00:00Z") }), p, cmp, now)).toEqual(
      [],
    );
    expect(
      evaluateRadar(radar({ lastNotifiedAt: new Date("2026-10-30T00:00:00Z") }), p, cmp, now),
    ).toHaveLength(1);
  });

  it("suggests comparable models only in scope, same size class, passing the saved requirements, meaningfully cheaper", () => {
    const tracked = product({ id: "p1", offers: [offer({ priceCents: 60000 })] });
    const sameBrandCheaper = product({ id: "p2", offers: [offer({ priceCents: 50000 })] });
    const otherBrand = product({ id: "p3", brand: "Samsung", offers: [offer({ priceCents: 45000 })] });
    const wrongSize = product({
      id: "p4",
      attributes: { size_class: "compact" },
      offers: [offer({ priceCents: 30000 })],
    });
    const failsFilter = product({ id: "p5", tags: ["builtin"], offers: [offer({ priceCents: 30000 })] });
    const barelyCheaper = product({ id: "p6", offers: [offer({ priceCents: 59000 })] });
    const all = {
      ...cmp,
      products: [tracked, sameBrandCheaper, otherBrand, wrongSize, failsFilter, barelyCheaper],
    };

    expect(evaluateRadar(radar({ scope: "only", baselinePriceCents: 60000 }), tracked, all)).toEqual([]);
    const brand = evaluateRadar(radar({ scope: "brand" }), tracked, all);
    expect(brand.map((e) => e.productId)).toEqual(["p2"]);
    const any = evaluateRadar(radar({ scope: "any" }), tracked, all);
    expect(any.map((e) => e.productId).sort()).toEqual(["p2", "p3"]);
    expect(any.every((e) => e.kind === "similar")).toBe(true);
  });
});
