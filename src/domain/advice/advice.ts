import { matchAll } from "@/domain/catalog/match";
import { numberAttr, stringAttr, boolAttr, type ProductView } from "@/domain/catalog/types";
import type { Answers } from "@/domain/questions/schema";

// "Vērts zināt" (docs/FILTERS_PLAN.md §2.7, §6.4): one step beyond the user's
// choices, stated with real numbers. Every note is deterministic, rounded in
// the shop's favour (never ours), and shown only when the gain is real:
// payback must be shorter than the product's typical life. No AI here.
//
// Output is structured; the results page turns it into Latvian via i18n.

export type CostConfig = {
  /** Electricity, cents per kWh. */
  energyCentsPerKwh: number;
  /** Water and sewage, cents per m³. */
  waterCentsPerM3: number;
  /** Coffee per cup, cents: beans in an automatic machine, capsule. */
  beanCupCents: number;
  capsuleCupCents: number;
  /** Vacuum bags per year, cents. */
  bagsPerYearCents: number;
};

export const DEFAULT_COSTS: CostConfig = {
  energyCentsPerKwh: 25,
  waterCentsPerM3: 350,
  beanCupCents: 15,
  capsuleCupCents: 45,
  bagsPerYearCents: 2000,
};

/** Typical life in years: payback beyond it is not a saving. */
const LIFE_YEARS: Record<string, number> = { fridge: 10, freezer: 10, washer: 10, dryer: 10, dish: 10 };
const SMALL_LIFE = 5;
/** Label cycles per year for water use (EU label basis). */
const CYCLES: Record<string, number> = { washer: 220, dish: 280 };
const ENERGY_ORDER = ["A", "B", "C", "D", "E", "F", "G"];

export type Offered = { product: ProductView; priceCents: number };

export type AdviceNote =
  | {
      kind: "energy_upgrade";
      to: Offered;
      extraCents: number;
      yearlySavingCents: number;
      paybackYears: number;
      fromClass: string;
      toClass: string;
    }
  | {
      kind: "cheaper_similar";
      to: Offered;
      savingCents: number;
      yearlyExtraCents: number;
      toClass: string | null;
    }
  | { kind: "quieter"; to: Offered; extraCents: number; fromDb: number; toDb: number }
  | { kind: "bigger"; to: Offered; extraCents: number; extraLitres: number }
  | { kind: "nofrost"; to: Offered; extraCents: number }
  | { kind: "heatpump"; to: Offered; extraCents: number; yearlySavingCents: number; paybackYears: number }
  | { kind: "coffee_cost"; to: Offered; capsuleCupCents: number; beanCupCents: number; paybackMonths: number }
  | { kind: "bags"; to: Offered | null; bagsPerYearCents: number; extraCents: number };

export type AdviceInput = {
  subcategoryId: string;
  answers: Answers;
  /** The pick advice is about (the recommended or first pick). */
  pick: Offered;
  /** Products that meet every hard answer (any price), each with its best in-stock price. */
  pool: Offered[];
  /** Products of the subcategory regardless of the type answer (coffee and dryer type notes). */
  anyType: Offered[];
  budgetMaxCents: number | null;
  costs: CostConfig;
};

function priorities(answers: Answers): string[] {
  const p = answers.priorities;
  return Array.isArray(p) ? p : [];
}

/** Yearly running cost in cents: electricity plus water where the label states it. Null when unknown. */
export function yearlyRunningCents(p: ProductView, subId: string, costs: CostConfig): number | null {
  const kwh = p.kwhYear ?? numberAttr(p, "kwh_year");
  if (kwh === null) return null;
  let cents = kwh * costs.energyCentsPerKwh;
  const water = numberAttr(p, "water_l_cycle");
  if (water !== null && CYCLES[subId]) cents += ((water * CYCLES[subId]!) / 1000) * costs.waterCentsPerM3;
  return cents;
}

/** How far over the pick's price an alternative may cost: up to +10 % over the budget, or +15 % of the pick. */
function ceiling(input: AdviceInput): number {
  return input.budgetMaxCents !== null
    ? Math.floor(input.budgetMaxCents * 1.1)
    : Math.floor(input.pick.priceCents * 1.15);
}

const better = (a: string, b: string) => ENERGY_ORDER.indexOf(a) < ENERGY_ORDER.indexOf(b);
const others = (input: AdviceInput) => input.pool.filter((o) => o.product.id !== input.pick.product.id);

function energyUpgrade(input: AdviceInput): AdviceNote | null {
  const life = LIFE_YEARS[input.subcategoryId] ?? SMALL_LIFE;
  const from = stringAttr(input.pick.product, "energy_class");
  const fromCost = yearlyRunningCents(input.pick.product, input.subcategoryId, input.costs);
  if (!from || fromCost === null) return null;
  let best: Extract<AdviceNote, { kind: "energy_upgrade" }> | null = null;
  for (const o of others(input)) {
    const to = stringAttr(o.product, "energy_class");
    const cost = yearlyRunningCents(o.product, input.subcategoryId, input.costs);
    if (!to || cost === null || !better(to, from)) continue;
    const extra = o.priceCents - input.pick.priceCents;
    if (extra <= 0 || o.priceCents > ceiling(input)) continue;
    // Saving rounded down, extra cost rounded up: never overstate the gain.
    const saving = Math.floor((fromCost - cost) / 100) * 100;
    if (saving <= 0) continue;
    const payback = extra / saving;
    if (payback > life) continue;
    if (!best || payback < best.paybackYears) {
      best = {
        kind: "energy_upgrade",
        to: o,
        extraCents: extra,
        yearlySavingCents: saving,
        paybackYears: payback,
        fromClass: from,
        toClass: to,
      };
    }
  }
  return best;
}

/** Same key specs for noticeably less money; the trade-off (energy) stated. */
function cheaperSimilar(input: AdviceInput): AdviceNote | null {
  const p = input.pick.product;
  const vol = numberAttr(p, "volume_l") ?? numberAttr(p, "capacity_kg") ?? numberAttr(p, "place_settings");
  if (vol === null) return null;
  const pickCost = yearlyRunningCents(p, input.subcategoryId, input.costs);
  let best: Extract<AdviceNote, { kind: "cheaper_similar" }> | null = null;
  for (const o of others(input)) {
    const saving = input.pick.priceCents - o.priceCents;
    if (saving < Math.max(4000, input.pick.priceCents * 0.1)) continue;
    const v =
      numberAttr(o.product, "volume_l") ??
      numberAttr(o.product, "capacity_kg") ??
      numberAttr(o.product, "place_settings");
    if (v === null || v < vol * 0.95) continue;
    const cost = yearlyRunningCents(o.product, input.subcategoryId, input.costs);
    const yearlyExtra =
      pickCost !== null && cost !== null ? Math.ceil(Math.max(0, cost - pickCost) / 100) * 100 : 0;
    // Only a real saving: the price gap must outweigh ten years of extra running cost.
    if (yearlyExtra * 10 >= saving) continue;
    if (!best || saving > best.savingCents) {
      best = {
        kind: "cheaper_similar",
        to: o,
        savingCents: saving,
        yearlyExtraCents: yearlyExtra,
        toClass: stringAttr(o.product, "energy_class"),
      };
    }
  }
  return best;
}

function quieter(input: AdviceInput): AdviceNote | null {
  const db = numberAttr(input.pick.product, "noise_db");
  if (db === null) return null;
  const opts = others(input)
    .map((o) => ({ o, d: numberAttr(o.product, "noise_db") }))
    .filter(
      ({ o, d }) =>
        d !== null && d <= db - 3 && o.priceCents > input.pick.priceCents && o.priceCents <= ceiling(input),
    )
    .sort((a, b) => a.o.priceCents - b.o.priceCents);
  const hit = opts[0];
  return hit
    ? {
        kind: "quieter",
        to: hit.o,
        extraCents: hit.o.priceCents - input.pick.priceCents,
        fromDb: db,
        toDb: hit.d!,
      }
    : null;
}

function bigger(input: AdviceInput): AdviceNote | null {
  const v = numberAttr(input.pick.product, "volume_l");
  if (v === null) return null;
  const opts = others(input)
    .map((o) => ({ o, l: numberAttr(o.product, "volume_l") }))
    .filter(
      ({ o, l }) =>
        l !== null && l >= v * 1.15 && o.priceCents > input.pick.priceCents && o.priceCents <= ceiling(input),
    )
    .sort((a, b) => a.o.priceCents - b.o.priceCents);
  const hit = opts[0];
  return hit
    ? {
        kind: "bigger",
        to: hit.o,
        extraCents: hit.o.priceCents - input.pick.priceCents,
        extraLitres: Math.floor(hit.l! - v),
      }
    : null;
}

function noFrost(input: AdviceInput): AdviceNote | null {
  if (boolAttr(input.pick.product, "no_frost") !== false) return null;
  const hit = others(input)
    .filter(
      (o) =>
        boolAttr(o.product, "no_frost") === true &&
        o.priceCents > input.pick.priceCents &&
        o.priceCents <= ceiling(input),
    )
    .sort((a, b) => a.priceCents - b.priceCents)[0];
  return hit ? { kind: "nofrost", to: hit, extraCents: hit.priceCents - input.pick.priceCents } : null;
}

/** Dryers: a heat-pump model's payback against the condenser pick. */
function heatpump(input: AdviceInput): AdviceNote | null {
  if (input.subcategoryId !== "dryer" || stringAttr(input.pick.product, "dryer_type") !== "condenser")
    return null;
  const fromCost = yearlyRunningCents(input.pick.product, "dryer", input.costs);
  const cap = numberAttr(input.pick.product, "capacity_kg");
  if (fromCost === null) return null;
  let best: Extract<AdviceNote, { kind: "heatpump" }> | null = null;
  for (const o of input.anyType) {
    if (stringAttr(o.product, "dryer_type") !== "heatpump") continue;
    const c = numberAttr(o.product, "capacity_kg");
    if (cap !== null && (c === null || c < cap)) continue;
    const cost = yearlyRunningCents(o.product, "dryer", input.costs);
    const extra = o.priceCents - input.pick.priceCents;
    if (cost === null || extra <= 0) continue;
    const saving = Math.floor((fromCost - cost) / 100) * 100;
    if (saving <= 0) continue;
    const payback = extra / saving;
    if (payback > 10) continue;
    if (!best || payback < best.paybackYears)
      best = { kind: "heatpump", to: o, extraCents: extra, yearlySavingCents: saving, paybackYears: payback };
  }
  return best;
}

/** Coffee: capsule cups cost several times more; when an automatic machine pays for itself. */
function coffeeCost(input: AdviceInput): AdviceNote | null {
  if (input.subcategoryId !== "coffee" || stringAttr(input.pick.product, "coffee_type") !== "capsule")
    return null;
  const cups = Number(input.answers.cups ?? 0);
  if (!Number.isFinite(cups) || cups < 2) return null;
  const autos = input.anyType
    .filter((o) => stringAttr(o.product, "coffee_type") === "auto")
    .filter(
      (o) =>
        !input.answers.milk ||
        input.answers.milk !== "yes" ||
        matchAll(o.product, [{ attr: "milk_system", eq: true }]) === true,
    )
    .sort((a, b) => a.priceCents - b.priceCents);
  const auto = autos[0];
  if (!auto) return null;
  const perMonth = (input.costs.capsuleCupCents - input.costs.beanCupCents) * cups * 30;
  const extra = auto.priceCents - input.pick.priceCents;
  if (perMonth <= 0 || extra <= 0) return null;
  const months = Math.ceil(extra / perMonth);
  if (months > 36) return null;
  return {
    kind: "coffee_cost",
    to: auto,
    capsuleCupCents: input.costs.capsuleCupCents,
    beanCupCents: input.costs.beanCupCents,
    paybackMonths: months,
  };
}

/** Vacuums: bags are a running cost; a bagless alternative near the same price. */
function bags(input: AdviceInput): AdviceNote | null {
  if (input.subcategoryId !== "vacuum" || boolAttr(input.pick.product, "bagless") !== false) return null;
  const alt = others(input)
    .filter((o) => boolAttr(o.product, "bagless") === true && o.priceCents <= ceiling(input))
    .sort((a, b) => a.priceCents - b.priceCents)[0];
  return {
    kind: "bags",
    to: alt ?? null,
    bagsPerYearCents: input.costs.bagsPerYearCents,
    extraCents: alt ? alt.priceCents - input.pick.priceCents : 0,
  };
}

/** At most two notes, most relevant first: the user's priorities, then category trade-offs. */
export function adviceNotes(input: AdviceInput, max = 2): AdviceNote[] {
  const pri = priorities(input.answers);
  const ordered: (AdviceNote | null)[] = [];
  if (pri.includes("energy")) ordered.push(energyUpgrade(input));
  if (pri.includes("quiet")) ordered.push(quieter(input));
  if (pri.includes("volume")) ordered.push(bigger(input));
  if (pri.includes("nofrost")) ordered.push(noFrost(input));
  ordered.push(heatpump(input), coffeeCost(input));
  if (!pri.includes("energy")) {
    // Without the priority, an energy upgrade is still worth telling when it pays back within 3 years.
    const e = energyUpgrade(input);
    ordered.push(e && e.kind === "energy_upgrade" && e.paybackYears <= 3 ? e : null);
  }
  ordered.push(cheaperSimilar(input), bags(input));
  const seen = new Set<string>();
  const out: AdviceNote[] = [];
  for (const n of ordered) {
    if (!n || out.length >= max) continue;
    const key = `${n.kind}:${n.to?.product.id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}
