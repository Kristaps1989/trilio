import { attributeType } from "@/domain/catalog/attributes";
import { boolAttr, numberAttr, stringAttr, type ProductView } from "@/domain/catalog/types";
import { energyCost10yCents } from "@/domain/energy/energy";
import { sameBrand } from "@/domain/ranking/score";

// Spec §3.2 upgrade delta, made truthful (docs/FILTERS_PLAN.md §2.8): "Par
// +180 € vairāk … tu iegūsti: +48 L tilpums · par 4 dB klusāks · labāka
// energoklase (D) · No Frost", downsides included. It compares the
// category's own attributes (categories.json `compare`) and tells three
// cases apart: the specs differ (list them), they are known and equal, or
// some are unknown. Only "known and equal" may say anything about brand.
// Structured output; the UI turns it into Latvian.

export type DeltaItem =
  | { kind: "number"; key: string; delta: number; better: boolean | null }
  | { kind: "energy_class"; from: string; to: string; better: boolean }
  | { kind: "boolean"; key: string; gained: boolean }
  | { kind: "enum"; key: string; from: string; to: string }
  | { kind: "energy_cost"; deltaCents: number; better: boolean };

/** For numeric keys: is a higher value better (null: neither), and the smallest difference worth mentioning. */
const NUMBER_RULES: Record<string, { higherIsBetter: boolean | null; minDelta: number }> = {
  volume_l: { higherIsBetter: true, minDelta: 10 },
  noise_db: { higherIsBetter: false, minDelta: 2 },
  capacity_kg: { higherIsBetter: true, minDelta: 1 },
  place_settings: { higherIsBetter: true, minDelta: 1 },
  run_min: { higherIsBetter: true, minDelta: 10 },
  power_w: { higherIsBetter: true, minDelta: 200 },
  spin_rpm: { higherIsBetter: true, minDelta: 200 },
  airflow_m3h: { higherIsBetter: true, minDelta: 100 },
  tank_l: { higherIsBetter: true, minDelta: 0.3 },
  zones: { higherIsBetter: true, minDelta: 1 },
  slots: { higherIsBetter: true, minDelta: 1 },
  trays: { higherIsBetter: true, minDelta: 1 },
  pressure_bar: { higherIsBetter: null, minDelta: 3 },
  steam_gmin: { higherIsBetter: true, minDelta: 10 },
  weight_kg: { higherIsBetter: false, minDelta: 0.3 },
};

/** Size differences matter for fit, not as an upgrade; they are compared in the table instead. */
const NOT_AN_UPGRADE = new Set([
  "height_cm",
  "width_cm",
  "depth_cm",
  "climate_class",
  "max_kg",
  "precision_g",
  "programs",
]);

const ENERGY_ORDER = ["A", "B", "C", "D", "E", "F", "G"];

export type UpgradeDelta = {
  priceDeltaCents: number;
  items: DeltaItem[];
  /**
   * "differs": items lists what differs. "same": every compared attribute is
   * known on both and equal. "unknown": nothing measurable differs but some
   * attribute is unknown on one side; the UI says nothing rather than guess.
   */
  status: "differs" | "same" | "unknown";
  brandsDiffer: boolean;
};

function known(p: ProductView, key: string): boolean {
  const v = p.attributes[key];
  return v !== undefined && v !== null && v !== "";
}

/** What the pricier product gives (and costs) compared with the cheaper one, over `keys`. */
export function upgradeDelta(
  cheaper: { product: ProductView; priceCents: number },
  pricier: { product: ProductView; priceCents: number },
  energyPriceCentsPerKwh: number,
  keys: string[],
): UpgradeDelta {
  const a = cheaper.product;
  const b = pricier.product;
  const items: DeltaItem[] = [];
  let allKnown = true;

  for (const key of keys) {
    if (NOT_AN_UPGRADE.has(key)) continue;
    if (!known(a, key) || !known(b, key)) {
      allKnown = false;
      continue;
    }
    const type = attributeType(key);
    if (key === "energy_class") {
      const ea = stringAttr(a, key)!;
      const eb = stringAttr(b, key)!;
      if (ea !== eb && ENERGY_ORDER.includes(ea) && ENERGY_ORDER.includes(eb)) {
        items.push({
          kind: "energy_class",
          from: ea,
          to: eb,
          better: ENERGY_ORDER.indexOf(eb) < ENERGY_ORDER.indexOf(ea),
        });
      }
    } else if (type === "number") {
      const rule = NUMBER_RULES[key];
      const va = numberAttr(a, key);
      const vb = numberAttr(b, key);
      if (!rule || va === null || vb === null) continue;
      const delta = Math.round((vb - va) * 10) / 10;
      if (Math.abs(delta) < rule.minDelta) continue;
      const better = rule.higherIsBetter === null ? null : rule.higherIsBetter ? delta > 0 : delta < 0;
      items.push({ kind: "number", key, delta, better });
    } else if (type === "boolean") {
      const va = boolAttr(a, key);
      const vb = boolAttr(b, key);
      if (va !== null && vb !== null && va !== vb) items.push({ kind: "boolean", key, gained: vb });
    } else {
      const va = String(a.attributes[key]);
      const vb = String(b.attributes[key]);
      if (va !== vb) items.push({ kind: "enum", key, from: va, to: vb });
    }
  }

  const ca = energyCost10yCents(a.kwhYear, energyPriceCentsPerKwh);
  const cb = energyCost10yCents(b.kwhYear, energyPriceCentsPerKwh);
  if (ca !== null && cb !== null && Math.abs(cb - ca) >= 2000) {
    items.push({ kind: "energy_cost", deltaCents: cb - ca, better: cb < ca });
  }

  // Better things first, then neutral, then the downsides.
  const rank = (i: DeltaItem) => {
    const good = i.kind === "boolean" ? i.gained : i.kind === "enum" ? null : i.better;
    return good === true ? 0 : good === null ? 1 : 2;
  };
  items.sort((x, y) => rank(x) - rank(y));

  return {
    priceDeltaCents: pricier.priceCents - cheaper.priceCents,
    items,
    status: items.length ? "differs" : allKnown ? "same" : "unknown",
    brandsDiffer: !sameBrand(a.brand, b.brand),
  };
}
