import { describe, expect, it } from "vitest";
import { getSubcategory } from "@/domain/questions/catalog";
import { candidatePool, rank, type Candidate, type RankInput } from "@/domain/ranking/rank";
import { offer, product } from "@/domain/testing/builders";
import {
  argumentTargets,
  assignRoles,
  bucketOption,
  catchFor,
  coverage,
  gainsOf,
  goodness,
  passesQualityFloor,
  priceConfidence,
  priorityTarget,
  reviewSummary,
  targetIn,
  targetOf,
  verdictFor,
  verdictsFor,
  whyNot,
  type VerdictContext,
} from "./confidence";

const fridge = getSubcategory("fridge")!;
const DECIDES = ["noise_db", "volume_l", "energy_class", "no_frost"];

const f = (name: string, price: number, extra: Record<string, unknown> = {}) =>
  product({
    name,
    price,
    attrs: {
      install: "free",
      doors: "two",
      height_cm: 176,
      width_cm: 60,
      volume_l: 300,
      noise_db: 39,
      energy_class: "D",
      no_frost: true,
      ...extra,
    },
  });

const input = (products: ReturnType<typeof f>[], answers: RankInput["answers"] = {}): RankInput => ({
  products,
  sub: fridge,
  answers: { install: "free", size: "h175", doors: "two", household: "4", ...answers },
  budget: { min: 40000, max: 80000 },
  urgency: "two_weeks",
  includeRefurbished: false,
});

const byId = (cs: Candidate[], id: string) => cs.find((c) => c.product.id === id)!;

describe("targets", () => {
  it("knows which way is better and reads the shopper's first priority", () => {
    expect(targetOf("noise_db")).toEqual({ attr: "noise_db", kind: "min" });
    expect(targetOf("volume_l")).toEqual({ attr: "volume_l", kind: "max" });
    expect(targetOf("energy_class")).toEqual({ attr: "energy_class", kind: "energy" });
    expect(targetOf("no_frost")).toEqual({ attr: "no_frost", kind: "bool" });
    expect(targetOf("width_cm")).toBeNull();
    expect(priorityTarget(fridge, { priorities: ["quiet"] })?.target).toEqual({
      attr: "noise_db",
      kind: "min",
    });
    expect(priorityTarget(fridge, { priorities: ["nofrost"] })?.target.kind).toBe("bool");
    expect(priorityTarget(fridge, {})).toBeNull();
    expect(argumentTargets(fridge, { priorities: ["volume"] }, DECIDES).map((t) => t.attr)).toEqual([
      "volume_l",
      "noise_db",
      "energy_class",
      "no_frost",
    ]);
    const p = f("Bosch A", 500, { energy_class: "B" });
    expect(goodness(p, { attr: "energy_class", kind: "energy" })).toBe(-1);
    expect(goodness(p, { attr: "noise_db", kind: "min" })).toBe(-39);
    expect(goodness(f("X", 1, { noise_db: undefined }), { attr: "noise_db", kind: "min" })).toBeNull();
  });
});

describe("roles", () => {
  const products = [
    f("Beko Cheap", 420, { noise_db: 42 }),
    f("Bosch Sensible", 520, { noise_db: 38, energy_class: "C" }),
    f("Bosch Quiet", 690, { noise_db: 34, energy_class: "C", volume_l: 330 }),
    f("Indesit Mid", 480, { noise_db: 40 }),
    f("Zzz Plain", 450, { noise_db: 41 }),
  ];
  const r = rank(input(products, { priorities: ["quiet"] }));
  const pool = candidatePool(input(products, { priorities: ["quiet"] })).filter((c) => c.price <= 80000);
  const target = priorityTarget(fridge, { priorities: ["quiet"] })!.target;
  const roles = assignRoles(r.picks, pool, fridge, target, DECIDES);

  it("earns each role against the whole pool, never from price position", () => {
    const quiet = roles.get("Bosch Quiet") ?? [];
    expect(quiet).toContain("priority");
    const all = [...roles.values()].flat();
    expect(all.filter((x) => x === "sensible")).toHaveLength(1);
    expect(all.filter((x) => x === "priority")).toHaveLength(1);
    // The sensible pick is the best value in the pool.
    const sensibleId = [...roles.entries()].find(([, v]) => v.includes("sensible"))?.[0];
    expect(r.picks.map((p) => p.product.id)).toContain(sensibleId);
  });

  it("gives no priority role when another pick is not clearly worse", () => {
    const tie = [f("Bosch One", 500, { noise_db: 38 }), f("Bosch Two", 700, { noise_db: 37, volume_l: 380 })];
    const t = rank(input(tie));
    const tp = candidatePool(input(tie));
    const rr = assignRoles(t.picks, tp, fridge, { attr: "noise_db", kind: "min" }, DECIDES);
    expect([...rr.values()].flat()).not.toContain("priority");
  });

  it("gives the cheapest-we-would-buy role only to the cheapest pick, past the quality floor", () => {
    const cheap = byId(pool, "Beko Cheap");
    // Beko is graded 2 for fridges: below the floor.
    expect(passesQualityFloor(cheap, pool, fridge, DECIDES)).toBe(false);
    expect(passesQualityFloor(byId(pool, "Indesit Mid"), pool, fridge, DECIDES)).toBe(true);
    const unknownFit = { ...byId(pool, "Indesit Mid"), fitUnknown: true };
    expect(passesQualityFloor(unknownFit, pool, fridge, DECIDES)).toBe(false);
    for (const [id, list] of roles) {
      if (!list.includes("cheapest_good")) continue;
      const cheapestPick = [...r.picks].sort((a, b) => a.price - b.price)[0]!;
      expect(id).toBe(cheapestPick.product.id);
    }
  });

  it("returns empty roles for an empty pool", () => {
    expect([...assignRoles([], [], fridge, null, DECIDES).values()]).toEqual([]);
  });
});

describe("verdict", () => {
  const products = [
    f("Indesit Small", 450, { noise_db: 40, volume_l: 290, kwh_year: 300 }),
    f("Bosch Quiet", 620, { noise_db: 35, volume_l: 300, kwh_year: 150 }),
    f("Zzz Mid", 520, { noise_db: 39, volume_l: 310, kwh_year: 290 }),
  ];
  const inp = input(products, { priorities: ["quiet"] });
  const r = rank(inp);
  const pool = candidatePool(inp);
  const ctx = (roles: VerdictContext["roles"] = []): VerdictContext => ({
    sub: fridge,
    answers: inp.answers,
    picks: r.picks,
    pool,
    targets: argumentTargets(fridge, inp.answers, DECIDES),
    decides: DECIDES,
    roles,
    energyPriceCentsPerKwh: 25,
    answerPhrases: { household: { lv: "x", en: "x" } },
  });

  it("starts from the shopper's own answer, then the lead on the priority", () => {
    const v = verdictFor(byId(r.picks, "Bosch Quiet"), ctx());
    expect(v[0]).toMatchObject({ kind: "answer_fit", questionId: "household", attr: "volume_l", value: 300 });
    expect(v[1]).toMatchObject({ kind: "leads", attr: "noise_db", value: 35 });
    expect(v).toHaveLength(2);
  });

  it("says when a dearer pick is cheaper over ten years, and never returns nothing", () => {
    const noPhrase = { ...ctx(), answerPhrases: {}, targets: [] };
    const v = verdictFor(byId(r.picks, "Bosch Quiet"), noPhrase);
    expect(v.map((x) => x.kind)).toContain("reliable");
    expect(v.some((x) => x.kind === "tco")).toBe(true);
    const bare = verdictFor(byId(r.picks, "Zzz Mid"), { ...noPhrase, decides: ["inverter"] });
    expect(bare).toEqual([{ kind: "thin", attrs: ["inverter"] }]);
    const value = verdictFor(byId(r.picks, "Zzz Mid"), { ...noPhrase, decides: [] });
    expect(value[0]!.kind).toBe("value");
    expect(verdictFor(byId(r.picks, "Zzz Mid"), { ...noPhrase, roles: ["cheapest_good"] })[0]!.kind).toBe(
      "cheapest_sound",
    );
  });
});

describe("verdicts for the picks together (docs/TRUST_POLISH_PLAN.md §2)", () => {
  const table = {
    reviewed: true,
    note: "",
    ungraded: [],
    brands: { Dreame: { grade: 4 } },
  } as unknown as VerdictContext["table"];
  const products = [
    f("Tristar T9", 540, { volume_l: 380, noise_db: 39 }),
    f("Dreame AF30", 790, { volume_l: 300, noise_db: 37 }),
    f("Dreame DZ30", 1068, { volume_l: 420, noise_db: 37 }),
  ];
  const inp = input(products, { household: "2" });
  const cands = products.map((p) => byId(candidatePool({ ...inp, budget: null }), p.id));
  const ctx: VerdictContext = {
    sub: fridge,
    answers: inp.answers,
    picks: cands,
    pool: cands,
    targets: [],
    decides: ["volume_l", "noise_db"],
    roles: [],
    energyPriceCentsPerKwh: 25,
    answerPhrases: {},
    table,
  };
  const v = verdictsFor(ctx, () => []);
  const keyOf = (id: string) => JSON.stringify(v.byId.get(id));

  it("says a brand grade shared by two picks once, above the cards", () => {
    expect(v.sharedBrand).toMatchObject({ brand: "Dreame", grade: 4, count: 2 });
    for (const parts of v.byId.values()) expect(parts.some((p) => p.kind === "reliable")).toBe(false);
  });

  it("gives every pick its own claim", () => {
    const all = products.map((p) => keyOf(p.id));
    expect(new Set(all).size).toBe(3);
    expect(v.byId.get("Dreame DZ30")![0]).toMatchObject({ kind: "leads", attr: "volume_l", value: 420 });
    expect(v.byId.get("Tristar T9")!.some((p) => p.kind === "cheaper")).toBe(true);
  });
});

describe("bucketOption", () => {
  it("names the size the product is, not only the one asked for", () => {
    const q = fridge.questions.find((x) => x.id === "household")!;
    const big = f("Big", 500, { volume_l: 420 });
    const b = bucketOption(q, big);
    expect(b?.attr).toBe("volume_l");
    const small = bucketOption(q, f("Small", 500, { volume_l: 150 }));
    expect(small === null || small.option.value !== b!.option.value).toBe(true);
  });
});

describe("the catch", () => {
  const products = [
    f("Bosch A", 500, { noise_db: 39 }),
    f("Bosch B", 670, { noise_db: 34 }),
    f("Bosch C", 560, { noise_db: 39, no_frost: false }),
  ];
  const pool = candidatePool(input(products));
  const targets = argumentTargets(fridge, { priorities: ["quiet"] }, DECIDES);

  it("names the best available on the priority and what it costs", () => {
    expect(catchFor(byId(pool, "Bosch A"), pool, targets)).toEqual({
      kind: "attr",
      attr: "noise_db",
      mine: 39,
      best: 34,
      extraCents: 17000,
      productId: "Bosch B",
    });
  });

  it("names a missing feature with the cheapest product that has it, or nothing when it is best", () => {
    const featureOnly = [{ attr: "no_frost", kind: "bool" as const }];
    expect(catchFor(byId(pool, "Bosch C"), pool, featureOnly)).toEqual({
      kind: "feature",
      attr: "no_frost",
      extraCents: -6000,
      productId: "Bosch A",
    });
    expect(catchFor(byId(pool, "Bosch B"), pool, [{ attr: "noise_db", kind: "min" }])).toBeNull();
  });
});

describe("why not", () => {
  const tall = f("Samsung Tall", 430, { height_cm: 186 });
  const cheapNoData = product({ name: "Zzz NoData", price: 410, attrs: { install: "free", doors: "two" } });
  const over = f("Bosch Over", 990, { noise_db: 33 });
  const dominated = f("Indesit Same", 560, { noise_db: 39 });
  const picks = [
    f("Indesit Pick", 500, { noise_db: 38 }),
    f("Bosch Pick", 650, { noise_db: 35, volume_l: 360 }),
  ];
  dominated.offers.push(
    offer({ storeId: "s2", priceCents: 57000 }),
    offer({ storeId: "s3", priceCents: 58000 }),
  );
  const products = [tall, cheapNoData, over, dominated, ...picks];
  const inp = input(products);
  const r = rank(inp);
  const lines = whyNot({
    products,
    sub: fridge,
    answers: inp.answers,
    budget: { min: 40000, max: 80000 },
    urgency: "two_weeks",
    picks: r.picks,
    scored: candidatePool({ ...inp, showUnknown: true }),
    decides: DECIDES,
  });
  const reasonOf = (id: string) => lines.find((l) => l.product.id === id)?.reason;

  it("explains the cheapest product in range with the shopper's own limit", () => {
    // The cheapest is the one without data: the shop does not state its height.
    expect(reasonOf("Zzz NoData")).toMatchObject({ kind: "unknown" });
    expect(lines.length).toBeLessThanOrEqual(4);
  });

  it("explains a fit failure, over-budget and a product a pick makes pointless", () => {
    const all = whyNot({
      products: [tall, over, dominated, ...picks],
      sub: fridge,
      answers: inp.answers,
      budget: { min: 40000, max: 80000 },
      urgency: "two_weeks",
      picks: r.picks,
      scored: candidatePool({ ...inp, showUnknown: true }),
      decides: DECIDES,
    });
    const reason = (id: string) => all.find((l) => l.product.id === id)?.reason;
    expect(reason("Samsung Tall")).toMatchObject({ kind: "fit", questionId: "size", value: 186 });
    expect(reason("Indesit Same")).toMatchObject({ kind: "dominated" });
  });

  it("names what the dearer pick gives, with both values, and skips a product with no such reason", () => {
    const quietPick = f("Bosch Quiet", 520, { noise_db: 34 });
    const loud = f("Beko Loud", 480, { noise_db: 40 });
    const same = f("Beko Twin", 515, { noise_db: 34 });
    const prods = [loud, same, quietPick];
    const ri = input(prods);
    const rr = rank(ri);
    const out = whyNot({
      products: prods,
      sub: fridge,
      answers: ri.answers,
      budget: { min: 40000, max: 80000 },
      urgency: "two_weeks",
      picks: rr.picks.filter((p) => p.product.id === "Bosch Quiet"),
      scored: candidatePool({ ...ri, showUnknown: true }),
      decides: DECIDES,
    });
    const reason = out.find((l) => l.product.id === "Beko Loud")?.reason;
    expect(reason).toMatchObject({
      kind: "weaker",
      byId: "Bosch Quiet",
      extraCents: 4000,
      gains: [{ attr: "noise_db", theirs: 34, mine: 40 }],
    });
  });

  it("leaves out colour variants of a pick", () => {
    const pick = f("Dreame AF30-WH", 600);
    const black = f("Dreame AF30-BK", 600);
    const prods = [pick, black];
    const ri = input(prods);
    const out = whyNot({
      products: prods,
      sub: fridge,
      answers: ri.answers,
      budget: { min: 40000, max: 80000 },
      urgency: "two_weeks",
      picks: rank(ri).picks.filter((p) => p.product.id === pick.id),
      scored: candidatePool({ ...ri, showUnknown: true }),
      decides: DECIDES,
    });
    expect(out.map((l) => l.product.id)).not.toContain(black.id);
  });

  it("never counts power as a gain where the category says it is none", () => {
    const a = product({ name: "Tristar A", attrs: { power_w: 1800, volume_l: 9 } });
    const b = product({ name: "Dreame B", attrs: { power_w: 3000, volume_l: 7 } });
    expect(gainsOf(b, a, ["power_w", "volume_l"], "airfryer")).toEqual([]);
    expect(gainsOf(a, b, ["power_w", "volume_l"], "airfryer")).toEqual([
      { attr: "volume_l", theirs: 9, mine: 7 },
    ]);
    expect(targetIn("power_w", "airfryer")).toBeNull();
  });

  it("never lists a pick", () => {
    const pickIds = new Set(r.picks.map((p) => p.product.id));
    expect(lines.some((l) => pickIds.has(l.product.id))).toBe(false);
  });
});

describe("reviews", () => {
  it("weights the shops' scores by count and needs ten reviews", () => {
    const p = product({ name: "Bosch R" });
    p.offers = [
      offer({ storeId: "a", ratingX10: 50, ratingCount: 6 }),
      offer({ storeId: "b", ratingX10: 40, ratingCount: 4 }),
      offer({ storeId: "c", ratingX10: null, ratingCount: null }),
    ];
    expect(reviewSummary(p)).toEqual({ x10: 46, count: 10, shops: 2 });
    p.offers = [offer({ ratingX10: 50, ratingCount: 9 })];
    expect(reviewSummary(p)).toBeNull();
  });
});

describe("price confidence", () => {
  const now = new Date("2026-10-24T10:00:00Z");
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  const p = product({ name: "Bosch P" });
  p.offers = [offer({ storeId: "a", priceCents: 50000 }), offer({ storeId: "b", priceCents: 50400 })];

  it("reports shops and their spread", () => {
    const c = priceConfidence(p, 50000, [], now);
    expect(c).toEqual({ shops: 2, spreadCents: 400, history: null });
  });

  it("says stable, lowest and was-lower only when the history shows it", () => {
    const flat = Array.from({ length: 20 }, (_, i) => ({ day: day(20 - i), priceCents: 50500 }));
    expect(priceConfidence(p, 50000, flat, now).history).toEqual({ kind: "stable" });
    const long = Array.from({ length: 40 }, (_, i) => ({ day: day(40 - i), priceCents: 52000 }));
    expect(priceConfidence(p, 50000, long, now).history).toEqual({ kind: "lowest" });
    const dip = [...flat.slice(0, 5), { day: day(12), priceCents: 46000 }, ...flat.slice(10)];
    expect(priceConfidence(p, 50000, dip, now).history).toEqual({
      kind: "was_lower",
      cents: 46000,
      daysAgo: 12,
    });
    expect(priceConfidence(p, 50000, flat.slice(15), now).history).toBeNull();
  });
});

describe("coverage", () => {
  it("counts products in stock, their shops and the last time we looked", () => {
    const a = product({ name: "A" });
    a.offers = [offer({ storeId: "s1", lastSeenAt: new Date("2026-10-24T06:00:00Z") })];
    const b = product({ name: "B" });
    b.offers = [offer({ storeId: "s2", lastSeenAt: new Date("2026-10-24T08:40:00Z") })];
    const gone = product({ name: "C" });
    gone.offers = [offer({ storeId: "s3", stock: "out" })];
    expect(coverage([a, b, gone], "two_weeks")).toEqual({
      products: 2,
      shops: 2,
      updatedAt: new Date("2026-10-24T08:40:00Z"),
    });
  });
});
