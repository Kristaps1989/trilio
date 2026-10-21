import { z } from "zod";
import { parseEnergyClass } from "@/domain/catalog/normalise";
import type { Subcategory } from "@/domain/questions/schema";
import { extractableAttributes, extractionSystem } from "./catalog-prompt";
import { type StructuredCaller, wrapUntrusted } from "./client";

// Shop text → typed attributes (data/attributes.json vocabulary) for one
// product whose spec table and rules left gaps. The model only reads; this
// module decides what is kept, and the result only fills gaps: every other
// source (EPREL, spec table, feed, rules) outranks it (SOURCE_PRIORITY).

export const MAX_EXTRACTION_INPUT = 4000;

export const ExtractionOutputSchema = z.object({
  attributes: z.array(
    z.object({
      key: z.string(),
      value: z.union([z.number(), z.string(), z.boolean()]),
    }),
  ),
  confidence: z.number().min(0).max(100),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

export type ExtractionInput = {
  name: string;
  specs: string | null;
  description: string | null;
  specTable?: Record<string, string> | null;
};

export type Extracted = {
  attributes: Record<string, number | string | boolean>;
  confidence: number;
};

/** Keeps only this subcategory's keys with the right type and plausible values. */
export function validateExtraction(out: ExtractionOutput, sub: Subcategory): Extracted {
  const allowed = extractableAttributes(sub.id);
  const attributes: Extracted["attributes"] = {};
  for (const { key, value } of out.attributes) {
    const spec = allowed[key];
    if (!spec) continue;
    if (spec.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100_000) continue;
      attributes[key] = Math.round(value * 10) / 10;
    } else if (spec.type === "energy_class") {
      const c = typeof value === "string" ? parseEnergyClass(value) : null;
      if (c) attributes[key] = c;
    } else if (spec.type === "enum") {
      if (typeof value === "string" && spec.values!.includes(value)) attributes[key] = value;
    } else if (spec.type === "boolean") {
      if (typeof value === "boolean") attributes[key] = value;
    } else if (typeof value === "string") {
      const s = value.trim().slice(0, 40);
      if (s) attributes[key] = s;
    }
  }
  const confidence = Math.max(0, Math.min(100, Math.round(out.confidence)));
  return { attributes, confidence };
}

/** Extractable keys the product does not have yet: the only ones worth a call. */
export function missingKeys(subcategoryId: string, attributes: Record<string, unknown>): string[] {
  return Object.keys(extractableAttributes(subcategoryId)).filter(
    (k) => attributes[k] === undefined || attributes[k] === null,
  );
}

export function extractionUserPrompt(input: ExtractionInput, missing?: string[]): string {
  const table = input.specTable
    ? Object.entries(input.specTable)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : null;
  const text = [
    `Title: ${input.name}`,
    table ? `Specification table:\n${table}` : null,
    input.specs ? `Specs: ${input.specs}` : null,
    input.description ? `Description: ${input.description}` : null,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_EXTRACTION_INPUT);
  // Asking only for what is missing keeps the answer short; the system prompt stays the same per subcategory (cached).
  const ask = missing?.length ? `Report only these keys: ${missing.join(", ")}.\n` : "";
  return `${ask}Extract attributes from this product text:\n${wrapUntrusted("product_text", text)}`;
}

export async function extractProduct(
  input: ExtractionInput,
  sub: Subcategory,
  caller: StructuredCaller,
  missing?: string[],
): Promise<Extracted | null> {
  const result = await caller({
    purpose: "attribute_extraction",
    system: extractionSystem(sub),
    user: extractionUserPrompt(input, missing),
    schema: ExtractionOutputSchema,
    maxTokens: 1024,
    effort: "low",
  });
  if (!result.ok) return null;
  return validateExtraction(result.value, sub);
}
