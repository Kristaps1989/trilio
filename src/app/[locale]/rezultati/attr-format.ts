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
      // An option may combine conditions (front loading AND not a washer-dryer): label each enum it names.
      for (const c of o.match ?? []) {
        if (typeof c.eq !== "string") continue;
        (out[c.attr] ??= {})[c.eq] ??= o.table_value ?? o.label;
      }
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
    // "apgr./min" is Latvian; the translator has the word for the page's language.
    const suffix = unit === "rpm" ? ta("unitRpm") : unit ? UNIT_SUFFIX[unit] : undefined;
    return suffix ? `${n} ${suffix}` : n;
  }
  return enums[key]?.[String(value)] ?? String(value);
}

export { betterDirection } from "@/domain/ranking/quality";
