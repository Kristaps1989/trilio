import { attributeType } from "@/domain/catalog/attributes";
import { boolAttr, numberAttr, stringAttr, type ProductView } from "@/domain/catalog/types";
import { energyCost10yCents } from "@/domain/energy/energy";
import { brandTable, gradeOf, ungradedSubcategory } from "@/domain/ranking/consider";
import { sameBrand, whyItFits, type ScoreReason } from "@/domain/ranking/score";

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
  | { kind: "energy_cost"; deltaCents: number; better: boolean }
  /** Brand reliability grade for the category; `from` null = the cheaper brand has no grade. */
  | { kind: "brand"; from: number | null; to: number; better: boolean }
  /** One of the shopper's wishes the pricier product meets and the cheaper one does not. */
  | { kind: "fit"; text: string };

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
  programme_min: { higherIsBetter: false, minDelta: 15 },
  quick_wash_min: { higherIsBetter: false, minDelta: 5 },
  water_l_cycle: { higherIsBetter: false, minDelta: 2 },
  moisture_pct: { higherIsBetter: false, minDelta: 3 },
  bin_l: { higherIsBetter: true, minDelta: 0.1 },
  suction_pa: { higherIsBetter: true, minDelta: 500 },
  cup_height_cm: { higherIsBetter: true, minDelta: 2 },
  warranty_months: { higherIsBetter: true, minDelta: 12 },
};

/** For numeric keys: is a higher value better (null: neither), and the smallest difference worth mentioning. */
export function numberRule(key: string): { higherIsBetter: boolean | null; minDelta: number } | undefined {
  return NUMBER_RULES[key];
}

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
  /** Why paying more makes sense (docs/UPGRADE_REASONS_PLAN.md). */
  gains: DeltaItem[];
  /** Differences that are neither better nor worse (a different type). */
  other: DeltaItem[];
  /** What the pricier one does worse. */
  tradeoffs: DeltaItem[];
};

/** Better (true), worse (false) or neither (null). */
export function goodness(i: DeltaItem): boolean | null {
  switch (i.kind) {
    case "boolean":
      return i.gained;
    case "enum":
      return null;
    case "fit":
      return true;
    default:
      return i.better;
  }
}

/**
 * The reasons beyond specs that the quality score counts: brand reliability
 * and answers met. No composite rating is published (docs/CONFIDENCE_PLAN.md B5).
 */
function scoreItems(
  a: { product: ProductView; reasons?: ScoreReason[] },
  b: { product: ProductView; reasons?: ScoreReason[] },
  subcategoryId: string | undefined,
): DeltaItem[] {
  const out: DeltaItem[] = [];
  if (subcategoryId && brandTable.reviewed && !ungradedSubcategory(brandTable, subcategoryId)) {
    const ga = gradeOf(brandTable, a.product.brand, subcategoryId);
    const gb = gradeOf(brandTable, b.product.brand, subcategoryId);
    if (gb !== null && ga !== gb && (ga !== null || gb >= 4))
      out.push({ kind: "brand", from: ga, to: gb, better: ga === null || gb > ga });
    else if (ga !== null && gb !== null && gb < ga)
      out.push({ kind: "brand", from: ga, to: gb, better: false });
  }
  if (a.reasons && b.reasons) {
    const had = new Set(whyItFits(a.reasons, 99));
    for (const text of whyItFits(b.reasons, 99)) if (!had.has(text)) out.push({ kind: "fit", text });
  }
  return out;
}

function known(p: ProductView, key: string): boolean {
  const v = p.attributes[key];
  return v !== undefined && v !== null && v !== "";
}

/** What the pricier product gives (and costs) compared with the cheaper one, over `keys`. */
export function upgradeDelta(
  cheaper: { product: ProductView; priceCents: number; reasons?: ScoreReason[] },
  pricier: { product: ProductView; priceCents: number; reasons?: ScoreReason[] },
  energyPriceCentsPerKwh: number,
  keys: string[],
  subcategoryId?: string,
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

  // What the shopper asked for first, then specs, then rating and brand.
  const extra = scoreItems(cheaper, pricier, subcategoryId);
  // A wish met says it in the shopper's words ("Birste dzīvnieku spalvām"): drop the same feature as a spec line.
  const fitTexts = new Set(extra.flatMap((i) => (i.kind === "fit" ? [i.text] : [])));
  const saidByFit = new Set(
    (pricier.reasons ?? [])
      .filter((r) => r.option.card_reason && fitTexts.has(r.option.card_reason))
      .flatMap((r) => (r.option.match ?? []).filter((m) => m.eq === true).map((m) => m.attr)),
  );
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === "boolean" && saidByFit.has(item.key)) items.splice(i, 1);
  }
  items.unshift(...extra.filter((i) => i.kind === "fit"));
  items.push(...extra.filter((i) => i.kind !== "fit"));

  // Better things first, then neutral, then the downsides.
  const rank = (i: DeltaItem) => {
    const good = goodness(i);
    return good === true ? 0 : good === null ? 1 : 2;
  };
  items.sort((x, y) => rank(x) - rank(y));

  return {
    priceDeltaCents: pricier.priceCents - cheaper.priceCents,
    items,
    status: items.length ? "differs" : allKnown ? "same" : "unknown",
    brandsDiffer: !sameBrand(a.brand, b.brand),
    gains: items.filter((i) => goodness(i) === true),
    other: items.filter((i) => goodness(i) === null),
    tradeoffs: items.filter((i) => goodness(i) === false),
  };
}
