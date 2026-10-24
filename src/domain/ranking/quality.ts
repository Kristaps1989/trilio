import type { ProductView } from "@/domain/catalog/types";
import { brandTable, gradeOf, ungradedSubcategory, type BrandTable } from "./consider";
import { sameBrand } from "./score";

// Product quality, so the picks are "the best quality for the money" rather
// than the cheapest product that passes the filters (owner, 19 Oct 2026: a
// fully equipped car at the same price beats a plain one). Two parts, both
// deterministic and explainable:
//  - the brand's reliability grade for this category (data/brands.json,
//    independent surveys, reviewed);
//  - how the product's specs compare with the other products in the same
//    search (energy class, noise, capacity, useful features).
// Price is not part of quality; rank.ts trades quality against price.

/** Which way is better for a numeric attribute (null: no "better", e.g. width). */
export function betterDirection(key: string): "min" | "max" | null {
  switch (key) {
    case "volume_l":
    case "capacity_kg":
    case "place_settings":
    case "run_min":
    case "airflow_m3h":
    case "spin_rpm":
    case "tank_l":
    case "zones":
    case "slots":
    case "trays":
    case "steam_gmin":
    case "programs":
    case "max_kg":
    case "bin_l":
    case "suction_pa":
    case "cup_height_cm":
    case "warranty_months":
      return "max";
    case "noise_db":
    case "weight_kg":
    case "kwh_year":
    case "water_l_cycle":
    case "precision_g":
    case "programme_min":
    case "quick_wash_min":
    case "moisture_pct":
      return "min";
    default:
      return null;
  }
}

/** Features that make a product better when present (not mere variants such as cordless). */
export const FEATURES = new Set([
  "anti_calc",
  "bagless",
  "booster",
  "convection",
  "flexi_zone",
  "heating",
  "hepa",
  "milk_system",
  "mop",
  "no_frost",
  "pet_brush",
  "pyrolytic",
  "steam",
  "temp_control",
  "third_basket",
  "wifi",
  "interchangeable_plates",
  "wet_dry",
  "clean_station",
  "ionic",
  "pressure_sensor",
  "inverter",
  "door_reversible",
  "fast_freeze",
  "auto_dose",
  "delay_start",
  "child_lock",
  "half_load",
  "self_empty",
  "cleaning_program",
  "auto_off",
]);

const ENERGY_ORDER = ["A", "B", "C", "D", "E", "F", "G"];

/** Points for the brand's reliability: grade 5 → +16, 3 → 0, 1 → −16; half weight on thin evidence. */
export const BRAND_GRADE_POINTS = 8;
/** A brand without independent reliability data: a small step below an average graded brand. */
export const UNGRADED_BRAND_POINTS = -4;
/** Points for specs at the top of the search versus the bottom. */
export const SPEC_POINTS = 24;

export function brandPoints(brand: string, subcategoryId: string, table: BrandTable = brandTable): number {
  if (!table.reviewed || ungradedSubcategory(table, subcategoryId)) return 0;
  const grade = gradeOf(table, brand, subcategoryId);
  if (grade === null) return UNGRADED_BRAND_POINTS;
  const entry = Object.entries(table.brands).find(([b]) => sameBrand(b, brand))?.[1];
  const weight = entry?.confidence === "low" ? 0.5 : 1;
  return Math.round((grade - 3) * BRAND_GRADE_POINTS * weight);
}

type Scale = (p: ProductView) => number | null;

/** 0 (worst in the pool) … 1 (best); null when the product does not state it or nobody differs. */
function scales(keys: string[], pool: ProductView[]): Scale[] {
  const out: Scale[] = [];
  for (const key of keys) {
    if (key === "energy_class") {
      const ranks = pool
        .map((p) => ENERGY_ORDER.indexOf(String(p.attributes.energy_class ?? "")))
        .filter((i) => i >= 0);
      const best = Math.min(...ranks);
      const worst = Math.max(...ranks);
      if (ranks.length < 2 || best === worst) continue;
      out.push((p) => {
        const i = ENERGY_ORDER.indexOf(String(p.attributes.energy_class ?? ""));
        return i < 0 ? null : (worst - i) / (worst - best);
      });
      continue;
    }
    if (FEATURES.has(key)) {
      const values = pool.map((p) => p.attributes[key]).filter((v) => typeof v === "boolean");
      if (new Set(values).size < 2) continue;
      out.push((p) => (typeof p.attributes[key] === "boolean" ? (p.attributes[key] ? 1 : 0) : null));
      continue;
    }
    const dir = betterDirection(key);
    if (!dir) continue;
    const nums = pool.map((p) => p.attributes[key]).filter((v): v is number => typeof v === "number");
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    if (nums.length < 2 || lo === hi) continue;
    out.push((p) => {
      const v = p.attributes[key];
      if (typeof v !== "number") return null;
      const t = (v - lo) / (hi - lo);
      return dir === "max" ? t : 1 - t;
    });
  }
  return out;
}

/**
 * Spec points for each product, relative to the pool (the products in the
 * same search). A value the shop does not state counts slightly below the
 * middle, so missing data never wins.
 */
export function specPoints(pool: ProductView[], keys: string[]): Map<string, number> {
  const s = scales(keys, pool);
  const out = new Map<string, number>();
  for (const p of pool) {
    if (s.length === 0) {
      out.set(p.id, 0);
      continue;
    }
    const parts = s.map((f) => f(p) ?? 0.4);
    const mean = parts.reduce((a, b) => a + b, 0) / parts.length;
    out.set(p.id, Math.round(mean * SPEC_POINTS));
  }
  return out;
}

/**
 * How much quality one whole price range is worth when choosing the best
 * value: a product at the top of the range must score this many points more
 * than one at the bottom to be preferred. Equal quality → the cheaper one;
 * equal price → the better one.
 */
export const PRICE_WEIGHT = 10;

export function valueScore(score: number, price: number, lo: number, hi: number): number {
  const rel = hi > lo ? (price - lo) / (hi - lo) : 0;
  return score - PRICE_WEIGHT * rel;
}
