import { z } from "zod";
import raw from "../../../data/attributes.json";

// The attribute catalogue (data/attributes.json): what each product attribute
// means, its unit, the spec-table labels shops use for it, how enum values
// (product form, type) are derived from shop text, which attributes decide
// fit per subcategory, and the sanity rules that keep mis-filed products out.
// Pure data + zod; no UI or DB imports.

const AttrSchema = z
  .object({
    type: z.enum(["number", "boolean", "string", "energy_class"]),
    unit: z.string().optional(),
    /** For ranges like "108 - 162 m³/h" or "49 līdz 58 dB": take the largest number. */
    pick: z.enum(["max"]).optional(),
    labels: z.array(z.string()),
    true: z.array(z.string()).optional(),
    false: z.array(z.string()).optional(),
    text: z.array(z.string()).optional(),
  })
  .strict();

const NumCondSchema = z.object({ lte: z.number().optional(), gte: z.number().optional() }).strict();

const EnumRuleSchema = z
  .object({
    value: z.string(),
    text: z.array(z.string()).optional(),
    spec: z.record(z.string(), z.string()).optional(),
    num: z.record(z.string(), NumCondSchema).optional(),
    always: z.boolean().optional(),
  })
  .strict();

const SubcategoryAttrsSchema = z
  .object({
    key: z.array(z.string()),
    fit: z.array(z.string()),
    enums: z.record(
      z.string(),
      z.object({ values: z.array(z.string()), rules: z.array(EnumRuleSchema) }).strict(),
    ),
    defaultFalse: z.array(z.string()),
    sanity: z
      .object({ stems: z.array(z.string()).min(1), priceEur: z.tuple([z.number(), z.number()]) })
      .strict(),
  })
  .strict();

export const AttributeCatalogSchema = z
  .object({
    note: z.string().optional(),
    attributes: z.record(z.string(), AttrSchema),
    /** Name patterns of spare parts and accessories. */
    accessory: z.array(z.string()),
    subcategories: z.record(z.string(), SubcategoryAttrsSchema),
  })
  .strict();

export type AttrDef = z.infer<typeof AttrSchema>;
export type EnumRule = z.infer<typeof EnumRuleSchema>;
export type SubcategoryAttrs = z.infer<typeof SubcategoryAttrsSchema>;
export type AttributeCatalog = z.infer<typeof AttributeCatalogSchema>;

export const attributeCatalog: AttributeCatalog = AttributeCatalogSchema.parse(raw);

export function subcategoryAttrs(subcategoryId: string): SubcategoryAttrs | undefined {
  return attributeCatalog.subcategories[subcategoryId];
}

/** Attributes whose absence keeps a product out of the picks for that subcategory. */
export function fitAttributes(subcategoryId: string): string[] {
  return subcategoryAttrs(subcategoryId)?.fit ?? [];
}

/** Type of an attribute: catalogue entry, or "enum" for derived per-subcategory values. */
export function attributeType(key: string): AttrDef["type"] | "enum" | undefined {
  if (attributeCatalog.attributes[key]) return attributeCatalog.attributes[key]!.type;
  for (const s of Object.values(attributeCatalog.subcategories)) if (s.enums[key]) return "enum";
  return undefined;
}

export function attributeUnit(key: string): string | undefined {
  return attributeCatalog.attributes[key]?.unit;
}
