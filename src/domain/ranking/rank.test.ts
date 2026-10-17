import { describe, expect, it } from "vitest";
import type { OfferView, ProductView } from "@/domain/catalog/types";
import { getSubcategory } from "@/domain/questions/catalog";
import { passesHardFilters, withinStretch } from "./filters";
import { rank, type RankInput } from "./rank";
import { matchedOptions, scoreProduct, whyItFits } from "./score";

const fridge = getSubcategory("fridge")!;
const kettle = getSubcategory("kettle")!;

let seq = 0;
function offer(o: Partial<OfferView>): OfferView {
  return {
    id: `o${++seq}`,
    storeId: "s1",
    storeName: "Veikals A",
    condition: "new",
    grade: null,
    warrantyMonths: null,
    priceCents: 50000,
    stock: "in",
    deliveryEtaDays: null,
    storeDefaultDeliveryDays: 3,
    url: "https://example.invalid/o",
    lowest30dCents: null,
    ...o,
  };
}

function product(p: Partial<ProductView> & { name: string }): ProductView {
  return {
    id: p.name,
    ean: null,
    brand: p.name.split(" ")[0]!,
    modelCode: p.name,
    subcategoryId: "fridge",
    attributes: {},
    tags: [],
    specs: null,
    kwhYear: null,
    rating: 80,
    imageUrl: null,
    extractionConfidence: null,
    offers: [offer({})],
    ...p,
  };
}

const base = (over: Partial<RankInput> = {}): RankInput => ({
  products: [],
  sub: fridge,
  answers: { type: "free", size: "tall", freezer: "yes" },
  budgetCents: 80000,
  urgency: "two_weeks",
  includeRefurbished: true,
  ...over,
});

const tallTags = ["free", "tall", "yes"];

describe("hard filters", () => {
  it("excludes products that contradict a hard answer and passes unknown ones as unconfirmed", () => {
    const builtin = product({ name: "Bosch builtin", tags: ["builtin", "tall", "yes"] });
    const unknown = product({ name: "Noname", tags: [] });
    const ok = product({ name: "Bosch tall", tags: tallTags });
    const a = { type: "free", size: "tall", freezer: "yes" };
    expect(passesHardFilters(builtin, fridge, a).pass).toBe(false);
    expect(passesHardFilters(unknown, fridge, a)).toEqual({
      pass: true,
      unconfirmed: ["type", "size", "freezer"],
    });
    expect(passesHardFilters(ok, fridge, a)).toEqual({ pass: true, unconfirmed: [] });
  });

  it("passthrough answers never filter", () => {
    const p = product({ name: "x", tags: ["free", "tall", "yes", "le186"] });
    expect(passesHardFilters(p, fridge, { type: "free", size: "tall", height_limit: "nolimit" }).pass).toBe(
      true,
    );
  });

  it("niche height compares the height attribute with tolerance", () => {
    const fits = product({ name: "fits", tags: ["builtin"], attributes: { height_cm: 177.5 } });
    const tooTall = product({ name: "tall", tags: ["builtin"], attributes: { height_cm: 193 } });
    const noData = product({ name: "nodata", tags: ["builtin"] });
    const a = { type: "builtin", niche: 178 };
    expect(passesHardFilters(fits, fridge, a).pass).toBe(true);
    expect(passesHardFilters(tooTall, fridge, a).pass).toBe(false);
    expect(passesHardFilters(noData, fridge, a)).toEqual({ pass: true, unconfirmed: ["niche"] });
  });

  it("hidden questions are ignored even if an answer lingers", () => {
    const p = product({ name: "x", tags: ["free", "wide"] });
    // freezer is hidden for wide; a stale 'no' answer must not filter
    expect(passesHardFilters(p, fridge, { type: "free", size: "wide", freezer: "no" }).pass).toBe(true);
  });
});

describe("scoring", () => {
  it("rating plus 12 per soft match, priorities weighted 15/12, −40 over budget", () => {
    const p = product({ name: "x", rating: 86, tags: [...tallTags, "4", "quiet", "energy"] });
    const answers = { ...base().answers, household: "4", priorities: ["quiet", "energy"] };
    const s = scoreProduct(p, fridge, answers);
    expect(s.score).toBe(86 + 12 + 15 + 12);
    expect(scoreProduct(p, fridge, answers, true).score).toBe(86 + 12 + 15 + 12 - 40);
    expect(
      matchedOptions(p, fridge, answers)
        .filter((r) => r.points > 0)
        .map((r) => r.option.value),
    ).toEqual(["4", "quiet", "energy"]);
  });

  it("whyItFits returns up to three distinct card reasons, strongest first", () => {
    const p = product({ name: "x", tags: [...tallTags, "4", "quiet", "energy", "nofrost"] });
    const answers = { ...base().answers, household: "4", priorities: ["quiet", "energy"] };
    const why = whyItFits(matchedOptions(p, fridge, answers));
    expect(why).toHaveLength(3);
    expect(why[0]).toBe("Kluss — 38 dB vai mazāk");
  });

  it("falls back to a default rating when none is known", () => {
    expect(scoreProduct(product({ name: "x", rating: null }), kettle, {}).score).toBe(70);
  });
});

describe("rank", () => {
  const products = [
    product({ name: "A cheap", rating: 70, tags: tallTags, offers: [offer({ priceCents: 45000 })] }),
    product({
      name: "B best",
      rating: 90,
      tags: [...tallTags, "quiet"],
      offers: [offer({ priceCents: 70000 })],
    }),
    product({ name: "C mid", rating: 80, tags: tallTags, offers: [offer({ priceCents: 60000 })] }),
    product({ name: "D pricey", rating: 95, tags: tallTags, offers: [offer({ priceCents: 90000 })] }),
    product({ name: "E far", rating: 99, tags: tallTags, offers: [offer({ priceCents: 150000 })] }),
  ];

  it("budget is a hard filter and picks are sorted into tiers with the badge on the top score", () => {
    const r = rank(base({ products, answers: { ...base().answers, priorities: ["quiet"] } }));
    expect(r.picks.map((p) => p.product.name)).toEqual(["A cheap", "C mid", "B best"]);
    expect(r.picks.map((p) => p.tier)).toEqual(["budget", "mid", "top"]);
    expect(r.picks.map((p) => p.recommended)).toEqual([false, false, true]);
    expect(r.picks.every((p) => p.offer.priceCents <= 80000)).toBe(true);
    expect(r.extras).toEqual([]);
    expect(r.matchingCount).toBe(3);
    expect(r.eligibleCount).toBe(5);
  });

  it("adds at most two extras up to 25 % over budget only when fewer than three fit", () => {
    const r = rank(base({ products, budgetCents: 50000 }));
    expect(r.picks.map((p) => p.product.name)).toEqual(["A cheap"]);
    expect(r.picks[0]!.tier).toBe("mid");
    expect(r.extras.map((p) => p.product.name)).toEqual(["C mid"]); // 60000 ≤ 62500; 70000 is not
    expect(r.extras[0]!.overBudgetByCents).toBe(10000);
    expect(withinStretch(62500, 50000)).toBe(true);
    expect(withinStretch(62501, 50000)).toBe(false);
  });

  it("returns nothing when nothing is within budget or close", () => {
    const r = rank(base({ products, budgetCents: 20000 }));
    expect(r.picks).toEqual([]);
    expect(r.extras).toEqual([]);
    expect(r.eligibleCount).toBe(5);
  });

  it("no budget means everything is in budget and no extras", () => {
    const r = rank(base({ products, budgetCents: null }));
    expect(r.picks).toHaveLength(3);
    expect(r.extras).toEqual([]);
  });

  it("respects urgency: asap uses in-stock offers only", () => {
    const soonOnly = product({
      name: "Soon",
      tags: tallTags,
      offers: [offer({ priceCents: 40000, stock: "soon" })],
    });
    const both = product({
      name: "Both",
      tags: tallTags,
      offers: [offer({ priceCents: 40000, stock: "soon" }), offer({ priceCents: 48000, stock: "in" })],
    });
    const asap = rank(base({ products: [soonOnly, both], urgency: "asap" }));
    expect(asap.picks.map((p) => p.product.name)).toEqual(["Both"]);
    expect(asap.picks[0]!.offer.priceCents).toBe(48000);
    const later = rank(base({ products: [soonOnly, both], urgency: "no_rush" }));
    expect(later.picks.map((p) => p.product.name).sort()).toEqual(["Both", "Soon"]);
    expect(later.picks.find((p) => p.product.name === "Both")!.offer.priceCents).toBe(40000);
  });

  it("never mixes refurbished offers into the picks and shows them in their own block with the saving", () => {
    const shared = product({
      name: "Samsung RB34",
      rating: 85,
      tags: tallTags,
      offers: [
        offer({ priceCents: 62900, condition: "new" }),
        offer({ priceCents: 46900, condition: "refurbished", grade: "A", warrantyMonths: 12 }),
      ],
    });
    const r = rank(base({ products: [...products, shared] }));
    expect(r.picks.every((p) => p.offer.condition === "new")).toBe(true);
    expect(r.extras.every((p) => p.offer.condition === "new")).toBe(true);
    expect(r.refurbished).toHaveLength(1);
    expect(r.refurbished[0]!.offer.condition).toBe("refurbished");
    expect(r.refurbished[0]!.savingVsNewCents).toBe(16000);
    expect(r.refurbished[0]!.newPriceCents).toBe(62900);

    const off = rank(base({ products: [...products, shared], includeRefurbished: false }));
    expect(off.refurbished).toEqual([]);
  });

  it("refurbished block also obeys budget and hard filters", () => {
    const refurbOnly = product({
      name: "Refurb builtin",
      tags: ["builtin", "tall", "yes"],
      offers: [offer({ priceCents: 30000, condition: "refurbished" })],
    });
    const refurbPricey = product({
      name: "Refurb pricey",
      tags: tallTags,
      offers: [offer({ priceCents: 99000, condition: "refurbished" })],
    });
    const r = rank(base({ products: [refurbOnly, refurbPricey] }));
    expect(r.picks).toEqual([]);
    expect(r.refurbished).toEqual([]);
  });

  it("the best price across stores is the one used", () => {
    const p = product({
      name: "Multi",
      tags: tallTags,
      offers: [
        offer({ priceCents: 71900, storeId: "s2", storeName: "Veikals B" }),
        offer({ priceCents: 68900, storeId: "s3", storeName: "Veikals C" }),
        offer({ priceCents: 60000, storeId: "s4", storeName: "Veikals D", stock: "out" }),
      ],
    });
    const r = rank(base({ products: [p] }));
    expect(r.picks[0]!.offer.priceCents).toBe(68900);
    expect(r.picks[0]!.offer.storeName).toBe("Veikals C");
  });

  it("carries unconfirmed question ids for products with missing data", () => {
    const p = product({ name: "Mystery", tags: [], offers: [offer({ priceCents: 50000 })] });
    const r = rank(base({ products: [p] }));
    expect(r.picks[0]!.unconfirmed).toEqual(["type", "size", "freezer"]);
  });
});
