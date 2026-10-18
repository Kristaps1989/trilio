import { attributeType, attributeUnit } from "@/domain/catalog/attributes";
import type { Subcategory } from "@/domain/questions/schema";
import { formatCm, formatDb, formatInt, formatLitres, formatNumber } from "@/i18n/format";

// Display of product attributes in the compare table, chips and card lines.
// Enum values ("combi", "heatpump") show the wording of the answer that
// matches them in categories.json, so the table speaks the same language as
// the questions.

type Translator = (key: string) => string;

/** attr → value → label, from the subcategory's options that match one enum value. */
export function enumLabels(sub: Subcategory): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const q of sub.questions) {
    for (const o of q.options) {
      if (!o.match || o.match.length !== 1) continue;
      const c = o.match[0]!;
      if (typeof c.eq !== "string") continue;
      (out[c.attr] ??= {})[c.eq] ??= o.table_value ?? o.label;
    }
  }
  return out;
}

const UNIT_SUFFIX: Record<string, string> = {
  kg: "kg",
  w: "W",
  rpm: "apgr./min",
  min: "min",
  m3h: "m³/h",
  gmin: "g/min",
  bar: "bar",
  g: "g",
  kwh: "kWh",
};

export function formatAttr(
  key: string,
  value: unknown,
  ta: Translator,
  enums: Record<string, Record<string, string>>,
): string {
  if (value === undefined || value === null || value === "") return ta("unknown");
  const type = attributeType(key);
  if (type === "boolean" || typeof value === "boolean") return value ? ta("yes") : ta("no");
  if (typeof value === "number") {
    const unit = attributeUnit(key);
    if (unit === "cm") return formatCm(value);
    if (unit === "l") return formatLitres(value);
    if (unit === "db") return formatDb(value);
    if (unit === "pcs") return formatInt(value);
    const n = Number.isInteger(value) ? formatInt(value) : formatNumber(value);
    return unit && UNIT_SUFFIX[unit] ? `${n} ${UNIT_SUFFIX[unit]}` : n;
  }
  return enums[key]?.[String(value)] ?? String(value);
}

/** Which way is better for the compare table's green shading (null: no "better"). */
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
      return "max";
    case "noise_db":
    case "weight_kg":
    case "kwh_year":
    case "water_l_cycle":
      return "min";
    default:
      return null;
  }
}
