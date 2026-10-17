import { boolAttr, numberAttr, stringAttr, type ProductView } from "@/domain/catalog/types";
import { energyCost10yCents } from "@/domain/energy/energy";

// Spec §3.2 upgrade delta: "Par +180 € vairāk nekā budžeta variants tu
// iegūsti: +48 L tilpums · par 4 dB klusāks · labāka energoklase (D) ·
// No Frost", including downsides ("~60 € vairāk par elektrību 10 gados").
// This module produces structured items; the UI turns them into Latvian
// through i18n so no copy lives here.

export type DeltaItem =
  | { kind: "number"; key: NumberKey; delta: number; better: boolean }
  | { kind: "energy_class"; from: string; to: string; better: boolean }
  | { kind: "boolean"; key: BooleanKey; gained: boolean }
  | { kind: "energy_cost"; deltaCents: number; better: boolean };

export type NumberKey =
  "volume_l" | "noise_db" | "capacity_kg" | "place_settings" | "run_min" | "power_w" | "spin_rpm";
export type BooleanKey =
  "no_frost" | "freezer" | "mop" | "pet_brush" | "hepa" | "wifi" | "steam" | "pyrolytic";

/** For each numeric key: is a higher value better, and the smallest difference worth mentioning. */
const NUMBER_RULES: Record<NumberKey, { higherIsBetter: boolean; minDelta: number }> = {
  volume_l: { higherIsBetter: true, minDelta: 10 },
  noise_db: { higherIsBetter: false, minDelta: 2 },
  capacity_kg: { higherIsBetter: true, minDelta: 1 },
  place_settings: { higherIsBetter: true, minDelta: 1 },
  run_min: { higherIsBetter: true, minDelta: 10 },
  power_w: { higherIsBetter: true, minDelta: 200 },
  spin_rpm: { higherIsBetter: true, minDelta: 200 },
};

const BOOLEAN_KEYS: BooleanKey[] = [
  "no_frost",
  "freezer",
  "mop",
  "pet_brush",
  "hepa",
  "wifi",
  "steam",
  "pyrolytic",
];

const ENERGY_ORDER = ["A", "B", "C", "D", "E", "F", "G"];

export type UpgradeDelta = {
  priceDeltaCents: number;
  items: DeltaItem[];
  /** True when nothing measurable differs: "atšķirība galvenokārt zīmolā un dizainā". */
  onlyBrandAndDesign: boolean;
};

/** What the pricier product gives (and costs) compared with the cheaper one. */
export function upgradeDelta(
  cheaper: { product: ProductView; priceCents: number },
  pricier: { product: ProductView; priceCents: number },
  energyPriceCentsPerKwh: number,
): UpgradeDelta {
  const items: DeltaItem[] = [];

  for (const key of Object.keys(NUMBER_RULES) as NumberKey[]) {
    const a = numberAttr(cheaper.product, key);
    const b = numberAttr(pricier.product, key);
    if (a === null || b === null) continue;
    const delta = Math.round((b - a) * 10) / 10;
    const rule = NUMBER_RULES[key];
    if (Math.abs(delta) < rule.minDelta) continue;
    items.push({ kind: "number", key, delta, better: rule.higherIsBetter ? delta > 0 : delta < 0 });
  }

  const ea = stringAttr(cheaper.product, "energy_class");
  const eb = stringAttr(pricier.product, "energy_class");
  if (ea && eb && ea !== eb && ENERGY_ORDER.includes(ea) && ENERGY_ORDER.includes(eb)) {
    items.push({
      kind: "energy_class",
      from: ea,
      to: eb,
      better: ENERGY_ORDER.indexOf(eb) < ENERGY_ORDER.indexOf(ea),
    });
  }

  for (const key of BOOLEAN_KEYS) {
    const a = boolAttr(cheaper.product, key);
    const b = boolAttr(pricier.product, key);
    if (a === null || b === null || a === b) continue;
    items.push({ kind: "boolean", key, gained: b });
  }

  const ca = energyCost10yCents(cheaper.product.kwhYear, energyPriceCentsPerKwh);
  const cb = energyCost10yCents(pricier.product.kwhYear, energyPriceCentsPerKwh);
  if (ca !== null && cb !== null && Math.abs(cb - ca) >= 2000) {
    items.push({ kind: "energy_cost", deltaCents: cb - ca, better: cb < ca });
  }

  // Better things first, then the downsides.
  items.sort((x, y) => Number(isBetter(y)) - Number(isBetter(x)));

  return {
    priceDeltaCents: pricier.priceCents - cheaper.priceCents,
    items,
    onlyBrandAndDesign: items.length === 0,
  };
}

function isBetter(i: DeltaItem): boolean {
  return i.kind === "boolean" ? i.gained : i.better;
}
