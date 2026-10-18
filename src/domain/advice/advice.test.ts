import { describe, expect, it } from "vitest";
import { product } from "@/domain/testing/builders";
import { adviceNotes, DEFAULT_COSTS, yearlyRunningCents } from "./advice";

const offered = (p: ReturnType<typeof product>, eur: number) => ({ product: p, priceCents: eur * 100 });
const fridge = (name: string, cls: string, kwh: number, extra: Record<string, unknown> = {}) =>
  product({
    name,
    attrs: { energy_class: cls, kwh_year: kwh, volume_l: 300, form: "combi", ...extra },
    kwhYear: kwh,
  });

describe("adviceNotes (§2.7 'Vērts zināt')", () => {
  it("the owner's example: €20 more buys class A instead of B and pays back within the fridge's life", () => {
    const pick = offered(fridge("Pick B", "B", 180), 500);
    const better = offered(fridge("Better A", "A", 100), 520);
    const notes = adviceNotes({
      subcategoryId: "fridge",
      answers: { priorities: ["energy"] },
      pick,
      pool: [pick, better],
      anyType: [],
      budgetMaxCents: 52300,
      costs: DEFAULT_COSTS,
    });
    expect(notes[0]).toMatchObject({
      kind: "energy_upgrade",
      extraCents: 2000,
      fromClass: "B",
      toClass: "A",
      yearlySavingCents: 2000,
    });
    expect((notes[0] as { paybackYears: number }).paybackYears).toBeCloseTo(1, 5);
  });

  it("no energy note when payback is longer than the product's life", () => {
    const pick = offered(fridge("Pick", "B", 180), 500);
    const pricey = offered(fridge("Pricey A", "A", 175), 549);
    const notes = adviceNotes({
      subcategoryId: "fridge",
      answers: { priorities: ["energy"] },
      pick,
      pool: [pick, pricey],
      anyType: [],
      budgetMaxCents: 50000,
      costs: DEFAULT_COSTS,
    });
    expect(notes.find((n) => n.kind === "energy_upgrade")).toBeUndefined();
  });

  it("washers count water too", () => {
    const w = product({
      name: "W",
      subcategoryId: "washer",
      attrs: { kwh_year: 100, water_l_cycle: 50 },
      kwhYear: 100,
    });
    // 100 kWh × 25 ct + 50 L × 220 cycles × 3,5 €/m³
    expect(yearlyRunningCents(w, "washer", DEFAULT_COSTS)).toBeCloseTo(2500 + 3850, 5);
  });

  it("dryers: heat pump payback against a condenser pick", () => {
    const pick = offered(
      product({
        name: "Cond",
        subcategoryId: "dryer",
        attrs: { dryer_type: "condenser", capacity_kg: 8 },
        kwhYear: 560,
      }),
      400,
    );
    const hp = offered(
      product({
        name: "HP",
        subcategoryId: "dryer",
        attrs: { dryer_type: "heatpump", capacity_kg: 8 },
        kwhYear: 235,
      }),
      490,
    );
    const notes = adviceNotes({
      subcategoryId: "dryer",
      answers: {},
      pick,
      pool: [pick],
      anyType: [pick, hp],
      budgetMaxCents: null,
      costs: DEFAULT_COSTS,
    });
    expect(notes[0]).toMatchObject({ kind: "heatpump", extraCents: 9000, yearlySavingCents: 8100 });
  });

  it("coffee: capsule cost per cup vs an automatic machine", () => {
    const pick = offered(
      product({ name: "Caps", subcategoryId: "coffee", attrs: { coffee_type: "capsule" } }),
      90,
    );
    const auto = offered(
      product({ name: "Auto", subcategoryId: "coffee", attrs: { coffee_type: "auto", milk_system: true } }),
      330,
    );
    const notes = adviceNotes({
      subcategoryId: "coffee",
      answers: { cups: "4" },
      pick,
      pool: [pick],
      anyType: [pick, auto],
      budgetMaxCents: null,
      costs: DEFAULT_COSTS,
    });
    // €240 more, (45 − 15) ct × 4 cups × 30 days = €36 a month → 7 months.
    expect(notes[0]).toMatchObject({ kind: "coffee_cost", paybackMonths: 7 });
  });

  it("at most two notes and nothing without real numbers", () => {
    const pick = offered(product({ name: "P", attrs: {} }), 500);
    expect(
      adviceNotes({
        subcategoryId: "fridge",
        answers: { priorities: ["energy", "quiet"] },
        pick,
        pool: [pick],
        anyType: [],
        budgetMaxCents: null,
        costs: DEFAULT_COSTS,
      }),
    ).toEqual([]);
  });
});
