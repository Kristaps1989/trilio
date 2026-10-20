import { describe, expect, it } from "vitest";
import type { OfferView, ProductView } from "@/domain/catalog/types";
import { decodeState } from "@/domain/flow/state";
import { getSubcategory } from "@/domain/questions/catalog";
import {
  currentOffer,
  dailyLows,
  dropMet,
  evaluateItem,
  productKey,
  searchKey,
  searchProposal,
} from "./wishlist";

const kettle = getSubcategory("kettle")!;
let n = 0;
const offer = (o: Partial<OfferView> = {}): OfferView => ({
  id: `o${++n}`,
  storeId: "s1",
  storeName: "A",
  condition: "new",
  grade: null,
  warrantyMonths: null,
  priceCents: 5000,
  stock: "in",
  deliveryEtaDays: null,
  storeDefaultDeliveryDays: 3,
  url: "https://x",
  lowest30dCents: null,
  ...o,
});
const product = (id: string, offers: OfferView[], attributes: Record<string, unknown> = {}): ProductView => ({
  id,
  ean: null,
  brand: "Bosch",
  modelCode: id,
  name: `Bosch ${id}`,
  subcategoryId: "kettle",
  attributes: { material: "steel", temp_control: false, volume_l: 1.7, power_w: 2200, ...attributes },
  tags: [],
  specs: null,
  kwhYear: null,
  rating: 8,
  imageUrl: null,
  extractionConfidence: null,
  offers,
});

describe("dropMet", () => {
  it.each([
    ["any", 10000, 9999, true],
    ["any", 10000, 10000, false],
    ["5", 10000, 9600, false],
    ["5", 10000, 9500, true],
    ["10", 10000, 9100, false],
    ["10", 10000, 9000, true],
  ] as const)("%s: %i → %i is %s", (t, a, b, expected) => {
    expect(dropMet(t, a, b)).toBe(expected);
  });
});

describe("currentOffer", () => {
  it("is the cheapest new offer in stock, never refurbished or sold out", () => {
    const p = product("a", [
      offer({ priceCents: 4000, condition: "refurbished" }),
      offer({ priceCents: 4500, stock: "out" }),
      offer({ priceCents: 5200 }),
      offer({ priceCents: 4900 }),
    ]);
    expect(currentOffer(p)?.priceCents).toBe(4900);
    expect(currentOffer(product("b", [offer({ stock: "out" })]))).toBeNull();
  });
});

describe("evaluateItem", () => {
  const item = { id: "i1", kind: "product" as const, baselinePriceCents: 10000, lastNotifiedAt: null };
  const now = new Date("2026-10-20T10:00:00Z");
  const at = (priceCents: number) => ({ productId: "a", offer: offer({ priceCents }) });

  it("reports a drop that meets the threshold", () => {
    expect(evaluateItem(item, at(9400), "5", now)).toMatchObject({
      itemId: "i1",
      kind: "product",
      oldPriceCents: 10000,
      newPriceCents: 9400,
    });
    expect(evaluateItem(item, at(9800), "5", now)).toBeNull();
    expect(evaluateItem(item, at(9800), "any", now)).not.toBeNull();
  });

  it("stays quiet within a day of the last e-mail, without a baseline or an offer", () => {
    expect(
      evaluateItem({ ...item, lastNotifiedAt: new Date("2026-10-20T00:00:00Z") }, at(5000), "any", now),
    ).toBeNull();
    expect(
      evaluateItem({ ...item, lastNotifiedAt: new Date("2026-10-19T09:00:00Z") }, at(5000), "any", now),
    ).not.toBeNull();
    expect(evaluateItem({ ...item, baselinePriceCents: null }, at(5000), "any", now)).toBeNull();
    expect(evaluateItem(item, null, "any", now)).toBeNull();
  });
});

describe("searchProposal", () => {
  it("returns today's recommended pick for the saved answers and price range", () => {
    const products = [
      product("steel-cheap", [offer({ priceCents: 2500 })]),
      product("steel-dear", [offer({ priceCents: 9000 })]),
      product("glass", [offer({ priceCents: 3000 })], { material: "glass" }),
    ];
    const state = decodeState(kettle, null);
    const all = searchProposal(products, kettle, state);
    expect(all.matchingCount).toBe(3);
    expect(all.top).not.toBeNull();

    const capped = searchProposal(products, kettle, {
      ...state,
      trailing: { ...state.trailing, budget: { max: 2800 } },
    });
    expect(capped.matchingCount).toBe(1);
    expect(capped.top?.product.id).toBe("steel-cheap");
  });

  it("has no proposal when nothing fits", () => {
    const state = decodeState(kettle, null);
    expect(searchProposal([], kettle, state)).toEqual({ top: null, matchingCount: 0 });
  });
});

describe("keys and history", () => {
  it("make one save per thing", () => {
    expect(productKey("x")).toBe("p:x");
    expect(searchKey("fridge", "abc")).toBe("s:fridge:abc");
  });

  it("keep the lowest price per day in date order", () => {
    expect(
      dailyLows([
        { day: "2026-10-02", priceCents: 500 },
        { day: "2026-10-01", priceCents: 700 },
        { day: "2026-10-02", priceCents: 450 },
      ]),
    ).toEqual([
      { day: "2026-10-01", priceCents: 700 },
      { day: "2026-10-02", priceCents: 450 },
    ]);
  });
});
