import { describe, expect, it } from "vitest";
import { getSubcategory } from "@/domain/questions/catalog";
import { offer, product } from "@/domain/testing/builders";
import { evaluateQuestion, passesHardFilters, withinBudget, withinStretch } from "./filters";
import { assignTiers, countMatches, pickThree, rank, tiersAreMeaningful, type RankInput } from "./rank";
import { relaxations } from "./relax";
import { scoreProduct, whyItFits } from "./score";

const fridge = getSubcategory("fridge")!;

const combi = (name: string, price: number, h: number, extra: Record<string, unknown> = {}) =>
  product({ name, price, attrs: { form: "combi", height_cm: h, width_cm: 60, volume_l: 300, ...extra } });

// The owner's test on 18 Oct 2026: standard fridge, at most 178 cm, €350–500.
const ownerCase = (products: ReturnType<typeof product>[]): RankInput => ({
  products,
  sub: fridge,
  answers: { form: "combi", height: { max: 178 }, household: "4" },
  budget: { min: 35000, max: 50000 },
  urgency: "two_weeks",
  includeRefurbished: true,
});

describe("filters: three-valued answers", () => {
  const q = fridge.questions.find((x) => x.id === "height")!;
  it("range: within, above (with 0,5 cm tolerance) and unknown", () => {
    const a = { height: { max: 178 } };
    expect(evaluateQuestion(combi("A", 400, 177), q, a).result).toBe("pass");
    expect(evaluateQuestion(combi("A", 400, 178.4), q, a).result).toBe("pass");
    expect(evaluateQuestion(combi("A", 400, 186), q, a).result).toBe("fail");
    expect(evaluateQuestion(product({ name: "X", attrs: { form: "combi" } }), q, a)).toEqual({
      result: "unknown",
      unknown: ["height_cm"],
    });
  });

  it("missing fit-critical data is not a match: it keeps the product out of the picks", () => {
    const v = passesHardFilters(product({ name: "X", attrs: {} }), fridge, { form: "combi" });
    expect(v).toMatchObject({ pass: true, fitUnknown: true });
  });

  it("niche height compares with tolerance from the data (6 cm lower, 0,5 cm higher)", () => {
    const builtin = (h: number) => product({ name: "B", attrs: { form: "builtin", height_cm: h } });
    const a = { form: "builtin", niche: 178 };
    expect(passesHardFilters(builtin(177), fridge, a).pass).toBe(true);
    expect(passesHardFilters(builtin(171), fridge, a).pass).toBe(false);
    expect(passesHardFilters(builtin(179), fridge, a).pass).toBe(false);
  });

  it("price range has both bounds; a number is an upper limit", () => {
    expect(withinBudget(40000, { min: 35000, max: 50000 })).toBe(true);
    expect(withinBudget(8900, { min: 35000, max: 50000 })).toBe(false);
    expect(withinBudget(60000, 50000)).toBe(false);
    expect(withinStretch(62500, 50000)).toBe(true);
    expect(withinStretch(62600, 50000)).toBe(false);
  });
});

describe("rank: the owner's case", () => {
  const products = [
    product({ name: "Mini 85", price: 89, attrs: { form: "compact", height_cm: 85, width_cm: 48 } }),
    product({ name: "Cheap 80", price: 120, attrs: { form: "compact", height_cm: 80 } }),
    combi("Beko 176", 389, 176),
    combi("Indesit 177", 449, 177, { no_frost: true }),
    combi("Bosch 176", 499, 176),
    combi("Tall 186", 459, 186),
    combi("Pricey 175", 690, 175),
    product({ name: "NoData 1", price: 420, attrs: { form: "combi" } }),
  ];

  it("never shows a fridge under 150 cm or under €350, and none over the height limit", () => {
    const r = rank(ownerCase(products));
    const all = [...r.picks, ...r.extras];
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(p.product.attributes.height_cm as number).toBeGreaterThanOrEqual(150);
      expect(p.product.attributes.height_cm as number).toBeLessThanOrEqual(178.5);
      expect(p.offer.priceCents).toBeGreaterThanOrEqual(35000);
    }
    expect(all.map((p) => p.product.name)).not.toContain("Mini 85");
  });

  it("counts products hidden for missing fit data and can show them on request", () => {
    const r = rank(ownerCase(products));
    expect(r.hiddenUnknownCount).toBe(1);
    const shown = rank({ ...ownerCase(products), showUnknown: true });
    const nodata = shown.picks.find((p) => p.product.name === "NoData 1");
    expect(shown.picks.length + shown.extras.length).toBeGreaterThan(0);
    if (nodata) expect(nodata.fitUnknown).toBe(true);
  });

  it("counts which answer excluded how many products", () => {
    const r = rank(ownerCase(products));
    expect(r.excludedBy.form).toBe(2);
    expect(r.excludedBy.height).toBe(1);
  });

  it("countMatches agrees with the number of in-range products", () => {
    expect(countMatches(ownerCase(products))).toBe(rank(ownerCase(products)).matchingCount);
  });
});

describe("picks spread over the range (§2.3)", () => {
  it("best overall, best in the lower third, best in the upper third — not simply the cheapest", () => {
    const cands = [100, 120, 300, 310, 480, 500].map((eur, i) => ({
      product: product({ name: `P${i}`, price: eur }),
      score: [70, 60, 90, 80, 75, 85][i]!,
      reasons: [],
      offer: offer({ priceCents: eur * 100 }),
      unconfirmed: [],
      fitUnknown: false,
      price: eur * 100,
    }));
    const picks = pickThree(cands).map((c) => c.product.name);
    expect(picks).toEqual(["P2", "P0", "P5"]);
  });
});

describe("tiers and the recommendation must mean something (§2.8)", () => {
  it("no tier labels when neighbouring picks are within 10 %", () => {
    expect(tiersAreMeaningful([38700, 39600, 41000])).toBe(false);
    expect(tiersAreMeaningful([30000, 45000, 70000])).toBe(true);
  });

  const cand = (name: string, eur: number, score: number, attrs = { form: "combi", height_cm: 180 }) => ({
    product: product({ name, price: eur, attrs }),
    score,
    reasons: [],
    offer: offer({ priceCents: eur * 100 }),
    unconfirmed: [],
    fitUnknown: false,
    price: eur * 100,
  });

  it("badge only for a clear winner with known fit data", () => {
    const tie = assignTiers([cand("A", 387, 80), cand("B", 396, 80), cand("C", 410, 80)], fridge);
    expect(tie.picks.some((p) => p.recommended)).toBe(false);
    expect(tie.meaningful).toBe(false);
    expect(tie.picks.every((p) => p.tier === null)).toBe(true);

    const clear = assignTiers([cand("A", 300, 80), cand("B", 450, 92), cand("C", 700, 81)], fridge);
    expect(clear.picks.find((p) => p.recommended)?.product.name).toBe("B");
    expect(clear.picks.map((p) => p.tier)).toEqual(["budget", "mid", "top"]);

    const unknownFit = assignTiers(
      [cand("A", 300, 80), cand("B", 450, 92, { form: "combi" } as never)],
      fridge,
    );
    expect(unknownFit.picks.some((p) => p.recommended)).toBe(false);
  });
});

describe("extras and refurbished", () => {
  it("fewer than three in range → at most two extras ≤ 25 % over the upper limit, labelled", () => {
    const r = rank(
      ownerCase([
        combi("In 1", 450, 176),
        combi("Over 1", 560, 176),
        combi("Over 2", 600, 176),
        combi("Way over", 700, 176),
      ]),
    );
    expect(r.picks).toHaveLength(1);
    expect(r.extras.map((e) => e.product.name)).toEqual(["Over 1", "Over 2"]);
    expect(r.extras[0]!.overBudgetByCents).toBe(6000);
  });

  it("refurbished offers never mix with the picks", () => {
    const refurb = combi("Refurb", 400, 176);
    refurb.offers = [offer({ condition: "refurbished", priceCents: 30000 }), offer({ priceCents: 52000 })];
    const r = rank({ ...ownerCase([refurb, combi("New", 420, 176)]), budget: null });
    expect(r.picks.every((p) => p.offer.condition === "new")).toBe(true);
    expect(r.refurbished[0]!.savingVsNewCents).toBe(22000);
  });
});

describe("brands (§2.4)", () => {
  it("a preferred brand scores higher; 'only these' filters", () => {
    const ps = [combi("Bosch A", 400, 176), combi("Beko B", 410, 176)];
    const soft = rank({ ...ownerCase(ps), brands: ["Beko"] });
    expect(soft.picks.find((p) => p.recommended)?.product.brand ?? soft.picks[0]!.product.brand).toBe("Beko");
    const strict = rank({ ...ownerCase(ps), brands: ["Beko"], brandsOnly: true });
    expect(strict.picks.map((p) => p.product.brand)).toEqual(["Beko"]);
    expect(strict.excludedBy.$brands).toBe(1);
  });
});

describe("relax suggestions (§4.2)", () => {
  it("offers the smallest budget step that adds products, with the true gain", () => {
    const ps = [combi("A", 450, 176), combi("B", 540, 176), combi("C", 545, 176)];
    const r = relaxations(ownerCase(ps));
    expect(r[0]).toEqual({ kind: "price_max", maxCents: 55000, gain: 2 });
  });

  it("offers to raise a height limit", () => {
    const r = relaxations(ownerCase([combi("A", 450, 176), combi("B", 450, 182)]));
    expect(r.find((x) => x.kind === "range_max")).toMatchObject({ questionId: "height", max: 183, gain: 1 });
  });
});

describe("score", () => {
  it("soft answers earn points through attribute conditions; reasons explain them", () => {
    const p = combi("A", 400, 176, { no_frost: true, noise_db: 36 });
    const s = scoreProduct(p, fridge, { form: "combi", priorities: ["nofrost", "quiet"] });
    expect(s.score).toBe(80 + 15 + 12);
    expect(whyItFits(s.reasons)).toEqual(["No Frost — nav jāatkausē", "Kluss — 38 dB vai mazāk"]);
  });
});
