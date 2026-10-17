import { z } from "zod";
import type { Subcategory } from "@/domain/questions/schema";
import { ATTRIBUTE_KEYS, extractionSystem } from "./catalog-prompt";
import { type StructuredCaller, wrapUntrusted } from "./client";

// Feed text → structured attributes + question tags for one product. The
// model only reads; this module decides what is kept. Feed-provided
// attributes always win over extracted ones.

export const MAX_EXTRACTION_INPUT = 4000;

export const ExtractionOutputSchema = z.object({
  attributes: z.array(
    z.object({
      key: z.string(),
      value: z.union([z.number(), z.string(), z.boolean()]),
    }),
  ),
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(100),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

export type ExtractionInput = {
  name: string;
  specs: string | null;
  description: string | null;
};

export type Extracted = {
  attributes: Record<string, number | string | boolean>;
  tags: string[];
  confidence: number;
};

const ENERGY_CLASSES = new Set(["A", "B", "C", "D", "E", "F", "G"]);

/** Keeps only known keys with the right type and plausible values; unknown option tags are dropped. */
export function validateExtraction(out: ExtractionOutput, sub: Subcategory): Extracted {
  const attributes: Extracted["attributes"] = {};
  for (const { key, value } of out.attributes) {
    const spec = ATTRIBUTE_KEYS[key];
    if (!spec || typeof value !== spec.type) continue;
    if (spec.type === "number") {
      const n = value as number;
      if (!Number.isFinite(n) || n <= 0 || n > 100_000) continue;
      attributes[key] = Math.round(n * 10) / 10;
    } else if (key === "energy_class") {
      const c = String(value).trim().toUpperCase().replace(/\+.*$/, "");
      if (ENERGY_CLASSES.has(c)) attributes[key] = c;
    } else if (spec.type === "string") {
      const s = String(value).trim().slice(0, 40);
      if (s) attributes[key] = s;
    } else {
      attributes[key] = value as boolean;
    }
  }
  const allowed = new Set(
    sub.questions.flatMap((q) => q.options.filter((o) => !o.passthrough).map((o) => o.value)),
  );
  const tags = [...new Set(out.tags.filter((t) => allowed.has(t)))];
  const confidence = Math.max(0, Math.min(100, Math.round(out.confidence)));
  return { attributes, tags, confidence };
}

export function extractionUserPrompt(input: ExtractionInput): string {
  const text = [
    `Title: ${input.name}`,
    input.specs ? `Specs: ${input.specs}` : null,
    input.description ? `Description: ${input.description}` : null,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_EXTRACTION_INPUT);
  return `Extract attributes and tags from this product text:\n${wrapUntrusted("product_text", text)}`;
}

export async function extractProduct(
  input: ExtractionInput,
  sub: Subcategory,
  caller: StructuredCaller,
): Promise<Extracted | null> {
  const result = await caller({
    purpose: "attribute_extraction",
    system: extractionSystem(sub),
    user: extractionUserPrompt(input),
    schema: ExtractionOutputSchema,
    maxTokens: 1024,
    effort: "low",
  });
  if (!result.ok) return null;
  return validateExtraction(result.value, sub);
}

/** Feed attributes win; extracted ones fill gaps. Tags are the union. */
export function mergeExtraction(
  current: { attributes: Record<string, unknown>; tags: string[] },
  extracted: Extracted,
): { attributes: Record<string, unknown>; tags: string[] } {
  const attributes: Record<string, unknown> = { ...extracted.attributes, ...current.attributes };
  const tags = [...new Set([...current.tags, ...extracted.tags])];
  return { attributes, tags };
}
