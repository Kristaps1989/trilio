import { attributeCatalog, subcategoryAttrs, type EnumRule } from "./attributes";

// Shop spec table + product text → typed attributes (data/attributes.json).
// Deterministic: the same page always gives the same attributes. Every value
// records its source so a card can say where a number came from and better
// sources (EPREL) can replace weaker ones later.

export type AttributeSource = "eprel" | "spec_table" | "feed" | "same_ean" | "claude" | "claude_web" | "rule";

/** Higher wins when two sources disagree. */
export const SOURCE_PRIORITY: Record<AttributeSource, number> = {
  eprel: 6,
  spec_table: 5,
  feed: 4,
  same_ean: 3,
  rule: 2,
  claude: 1,
  claude_web: 1,
};

export type Normalised = {
  attributes: Record<string, number | string | boolean>;
  sources: Record<string, AttributeSource>;
};

export type ProductText = {
  name: string;
  /** The shop's category label (URL segment or feed category). Used for type rules, not for sanity. */
  category?: string | null;
  description?: string | null;
  specTable?: Record<string, string> | null;
};

const PLAUSIBLE: Record<string, [number, number]> = {
  cm: [1, 400],
  l: [0.05, 2000],
  kg: [0.01, 500],
  w: [1, 20000],
  db: [10, 120],
  rpm: [100, 3000],
  min: [1, 600],
  kwh: [1, 3000],
  m3h: [50, 2500],
  gmin: [1, 400],
  bar: [1, 25],
  pcs: [0, 200],
  g: [0.001, 100],
};

/** "185,5 cm" → 185.5; "1 855 mm" → 185.5 (unit cm); "1,2 kW" → 1200 (unit w). Null when no number or implausible. */
export function parseQuantity(value: string, unit: string | undefined, pick?: "max"): number | null {
  if (pick === "max") {
    // "108 - 162 m³/h", "49 līdz 58 dB": the largest value, with the unit from the end.
    const nums = [...value.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0]);
    if (nums.length > 1) {
      const tail = value.slice(value.lastIndexOf(nums[nums.length - 1]!) + nums[nums.length - 1]!.length);
      const parsed = nums.map((n) => parseQuantity(n + tail, unit)).filter((n): n is number => n !== null);
      return parsed.length ? Math.max(...parsed) : null;
    }
  }
  const m = value
    .replace(/ /g, " ")
    .match(/(-?\d{1,3}(?:[  ]\d{3})+|-?\d+)(?:[.,](\d+))?\s*([a-zA-Zāēīūšžčķļņģ°³/.²]*)/);
  if (!m) return null;
  let n = Number(`${m[1]!.replace(/[  ]/g, "")}.${m[2] ?? "0"}`);
  if (!Number.isFinite(n)) return null;
  const u = (m[3] ?? "").toLowerCase();
  switch (unit) {
    case "cm":
      if (u.startsWith("mm")) n /= 10;
      else if (u === "m") n *= 100;
      break;
    case "l":
      if (u.startsWith("ml")) n /= 1000;
      break;
    case "kg":
      if (u === "g" || u === "gr") n /= 1000;
      break;
    case "w":
      if (u.startsWith("kw")) n *= 1000;
      break;
    case "min":
      if (u === "h" || u.startsWith("st")) n *= 60;
      break;
  }
  const range = unit ? PLAUSIBLE[unit] : undefined;
  if (range && (n < range[0] || n > range[1])) return null;
  return Math.round(n * 10) / 10;
}

/** EU label class on the 2021 scale (A–G). Old "A+++" style classes are ignored: they are not comparable. */
export function parseEnergyClass(value: string): string | null {
  const m = value
    .trim()
    .toUpperCase()
    .match(/^([A-G])(?![+])\b/);
  return m ? m[1]! : null;
}

function anyMatch(patterns: string[] | undefined, text: string): boolean {
  return !!patterns?.some((p) => new RegExp(p, "i").test(text));
}

/** "Izmēri (G x P x A)": the letters in the label give the order (A = height, P = width, G/D = depth). */
function dimensionsFromLabel(label: string, value: string): Record<string, number> {
  const order = label.match(/\(([a-zāēīūšž])\s*[x×]\s*([a-zāēīūšž])\s*[x×]\s*([a-zāēīūšž])\)/i);
  const nums = value.match(/\d+(?:[.,]\d+)?/g);
  if (!order || !nums || nums.length < 3) return {};
  const mm = /mm/i.test(value);
  const out: Record<string, number> = {};
  const keyFor: Record<string, string> = {
    a: "height_cm",
    p: "width_cm",
    g: "depth_cm",
    d: "depth_cm",
    h: "height_cm",
    w: "width_cm",
  };
  [order[1], order[2], order[3]].forEach((letter, i) => {
    const key = keyFor[letter!.toLowerCase()];
    if (!key) return;
    let n = Number(nums[i]!.replace(",", "."));
    if (mm) n /= 10;
    if (n >= 1 && n <= 400) out[key] = Math.round(n * 10) / 10;
  });
  return out;
}

/** Name segments that start with a known spec label: "Dziļums 54 cm" → { dziļums: "54 cm" }. */
function labelledSegments(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  const labels = Object.values(attributeCatalog.attributes)
    .flatMap((d) => d.labels)
    .sort((a, b) => b.length - a.length);
  for (const segment of name.split(/\s*[|;]\s*/)) {
    const lower = segment.toLowerCase().trim();
    const label = labels.find((l) => lower.startsWith(l + " ") && /\d/.test(lower.slice(l.length)));
    if (label && out[label] === undefined) out[label] = segment.trim().slice(label.length).trim();
  }
  return out;
}

function haystack(t: ProductText, includeCategory: boolean): string {
  return [
    t.name,
    includeCategory ? t.category : null,
    t.description,
    ...Object.entries(t.specTable ?? {}).flat(),
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
}

function ruleHolds(
  rule: EnumRule,
  text: string,
  spec: Record<string, string>,
  attrs: Normalised["attributes"],
): boolean {
  if (rule.always) return true;
  if (rule.text && !anyMatch(rule.text, text)) return false;
  if (rule.spec) {
    const ok = Object.entries(rule.spec).some(([label, pattern]) => {
      const v = spec[label];
      return v !== undefined && new RegExp(pattern, "i").test(v);
    });
    if (!ok) return false;
  }
  if (rule.num) {
    for (const [key, cond] of Object.entries(rule.num)) {
      const v = attrs[key];
      if (typeof v !== "number") return false;
      if (cond.lte !== undefined && v > cond.lte) return false;
      if (cond.gte !== undefined && v < cond.gte) return false;
    }
  }
  return !!(rule.text || rule.spec || rule.num);
}

/** Attributes for one product of a subcategory, from its spec table and text. */
export function normaliseProduct(subcategoryId: string, t: ProductText): Normalised {
  const out: Normalised = { attributes: {}, sources: {} };
  const spec: Record<string, string> = { ...(t.specTable ?? {}) };
  const sub = subcategoryAttrs(subcategoryId);
  const wanted = new Set(sub?.key ?? []);
  // Physical facts used by type rules even when the category does not list them as key attributes.
  for (const k of [
    "height_cm",
    "width_cm",
    "depth_cm",
    "fridge_volume_l",
    "freezer_volume_l",
    "kwh_year",
    "energy_kwh_100",
  ])
    wanted.add(k);
  const set = (key: string, value: number | string | boolean, source: AttributeSource) => {
    if (out.attributes[key] !== undefined) return;
    out.attributes[key] = value;
    out.sources[key] = source;
  };

  // 1. Labelled values from the spec table, then from "Label value" segments of the
  // name (m79.lv: "INDESIT | Veļas mašīna | … | Dziļums 54 cm | Mazgāšanas ietilpība 7kg").
  const fromName = labelledSegments(t.name);
  for (const [label, value] of Object.entries(fromName)) if (spec[label] === undefined) spec[label] = value;
  for (const [label, value] of Object.entries(spec)) {
    for (const [k, v] of Object.entries(dimensionsFromLabel(label, value))) set(k, v, "spec_table");
  }
  for (const [key, def] of Object.entries(attributeCatalog.attributes)) {
    if (!wanted.has(key)) continue;
    const label = def.labels.find((l) => spec[l] !== undefined);
    if (label === undefined) continue;
    const value = spec[label]!;
    if (def.type === "number") {
      const n = parseQuantity(value, def.unit, def.pick);
      if (n !== null) set(key, n, "spec_table");
    } else if (def.type === "energy_class") {
      const c = parseEnergyClass(value);
      if (c) set(key, c, "spec_table");
    } else if (def.type === "boolean") {
      if (anyMatch(def.true, value)) set(key, true, "spec_table");
      else if (anyMatch(def.false, value)) set(key, false, "spec_table");
    } else {
      const s = value.trim().slice(0, 40);
      if (s) set(key, s, "spec_table");
    }
  }

  // 2. Booleans stated in the product text ("No Frost" in the name). Absence proves nothing.
  const text = haystack(t, true);
  for (const [key, def] of Object.entries(attributeCatalog.attributes)) {
    if (!wanted.has(key) || def.type !== "boolean" || out.attributes[key] !== undefined) continue;
    if (anyMatch(def.text, text)) set(key, true, "rule");
  }

  // 3. Derived values.
  const a = out.attributes;
  if (a.volume_l === undefined) {
    const fridge = typeof a.fridge_volume_l === "number" ? a.fridge_volume_l : null;
    const freezer = typeof a.freezer_volume_l === "number" ? a.freezer_volume_l : null;
    // A freezer's volume is its freezer volume; a fridge's is both compartments.
    const total = subcategoryId === "freezer" ? freezer : fridge !== null ? fridge + (freezer ?? 0) : null;
    if (total !== null && total > 0) set("volume_l", total, "spec_table");
  }
  const climate = out.attributes.climate_class;
  if (wanted.has("garage_ok") && typeof climate === "string" && /sn/i.test(climate))
    set("garage_ok", true, "rule");
  if (subcategoryId === "washer" || subcategoryId === "dish") {
    // EU label: kWh per 100 cycles; a year is 220 washing or 280 dishwashing cycles (label basis).
    // Shops often print the label's per-100-cycles figure under a generic "energy use" label;
    // no washer or dishwasher uses under 150 kWh a year, so a smaller figure is per 100 cycles.
    if (typeof a.kwh_year === "number" && a.kwh_year < 150 && a.energy_kwh_100 === undefined) {
      a.energy_kwh_100 = a.kwh_year;
      out.sources.energy_kwh_100 = out.sources.kwh_year!;
      delete a.kwh_year;
    }
    const per100 = a.energy_kwh_100;
    if (typeof per100 === "number" && a.kwh_year === undefined) {
      set("kwh_year", Math.round(per100 * (subcategoryId === "washer" ? 2.2 : 2.8)), "rule");
    }
  }

  // 4. Enum values (product form, type) by ordered rules.
  for (const [key, def] of Object.entries(sub?.enums ?? {})) {
    const rule = def.rules.find((r) => ruleHolds(r, text, spec, out.attributes));
    if (rule) set(key, rule.value, "rule");
  }

  // 5. Feature flags that are false unless something says otherwise.
  for (const key of sub?.defaultFalse ?? []) set(key, false, "rule");

  return out;
}

/** Attributes any product has (size, weight): they do not show what kind of product it is. */
const GENERIC_ATTRS = new Set(["height_cm", "width_cm", "depth_cm", "weight_kg"]);

/**
 * Sanity check (docs/FILTERS_PLAN.md §1.4). Shops mis-file products (m79.lv
 * lists toys under coffee machines), so the shop's category alone is not
 * proof. A product passes when its own text names what it is (name,
 * description or spec table, not the category), or when its spec table has
 * an attribute specific to the category (tet.lv names are often only a model
 * code, but a dehydrator's spec table lists its trays and power). Its price
 * must also be plausible for the category.
 */
export function sanityCheck(
  subcategoryId: string,
  t: ProductText,
  priceCents: number,
  normalised?: Normalised,
): { ok: true } | { ok: false; reason: "category_mismatch" | "implausible_price" | "accessory" } {
  const sub = subcategoryAttrs(subcategoryId);
  if (!sub) return { ok: true };
  const text = haystack(t, false);
  if (attributeCatalog.accessory.some((p) => new RegExp(p, "i").test(t.name)))
    return { ok: false, reason: "accessory" };
  const named = sub.sanity.stems.some((s) => new RegExp(s, "i").test(text));
  const specific = Object.entries(normalised?.sources ?? {}).some(
    ([key, source]) => source === "spec_table" && sub.key.includes(key) && !GENERIC_ATTRS.has(key),
  );
  if (!named && !specific) return { ok: false, reason: "category_mismatch" };
  const [lo, hi] = sub.sanity.priceEur;
  if (priceCents < lo * 100 || priceCents > hi * 100) return { ok: false, reason: "implausible_price" };
  return { ok: true };
}

/**
 * Merges a shop's attributes into what the product already has (one product,
 * many shops, matched by EAN): a stronger source replaces a weaker one, an
 * equal source never overwrites (no flapping between shops), and gaps are
 * always filled, so one shop's spec table completes another shop's listing.
 */
export function mergeAttributes(
  current: { attributes: Record<string, unknown>; sources: Record<string, string> },
  incoming: { attributes: Record<string, unknown>; sources: Record<string, string> },
): { attributes: Record<string, unknown>; sources: Record<string, string> } {
  const attributes = { ...current.attributes };
  const sources = { ...current.sources };
  const rank = (s: string | undefined) =>
    s && s in SOURCE_PRIORITY ? SOURCE_PRIORITY[s as AttributeSource] : 0;
  for (const [key, value] of Object.entries(incoming.attributes)) {
    if (value === undefined || value === null) continue;
    const had = attributes[key] !== undefined && attributes[key] !== null;
    if (!had || rank(incoming.sources[key]) > rank(sources[key])) {
      attributes[key] = value;
      sources[key] = incoming.sources[key] ?? "feed";
    }
  }
  return { attributes, sources };
}
