import { z } from "zod";
import raw from "../../../data/brands.json";
import type { Candidate } from "./rank";
import { sameBrand } from "./score";

// "Vērts apsvērt — {zīmols}" (docs/FILTERS_PLAN.md §2.5): at most one card for
// a brand the user did not choose, when its product is at least as good as
// the user's top pick and costs less. AI drafts the brand table (data/brands.json),
// the owner reviews it, and this code makes the choice: nothing is shown
// until the table is marked reviewed.

const Grade = z.number().min(1).max(5);

const BrandSchema = z.object({
  /** 1 (weak) – 5 (strong): reliability, LV service network, warranty, per the cited sources. */
  grade: Grade,
  /** Per-subcategory grade where the evidence differs from the brand's usual standing. */
  categories: z.record(z.string(), Grade).optional(),
  serviceLv: z.boolean().optional(),
  warrantyYears: z.number().optional(),
  extendedWarranty: z.string().nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  evidence: z.array(z.string()).optional(),
  sources: z.array(z.string().url()).min(1),
});

const TableSchema = z.object({
  note: z.string().optional(),
  researchedAt: z.string().optional(),
  method: z.string().optional(),
  reviewed: z.boolean(),
  brands: z.record(z.string(), BrandSchema),
});

export type BrandTable = z.infer<typeof TableSchema>;

export const brandTable: BrandTable = TableSchema.parse(raw);

/** The brand's grade for this subcategory, else its overall grade; null when not in the table. */
export function gradeOf(table: BrandTable, brand: string, subcategoryId?: string): number | null {
  const hit = Object.entries(table.brands).find(([b]) => sameBrand(b, brand));
  if (!hit) return null;
  return (subcategoryId && hit[1].categories?.[subcategoryId]) || hit[1].grade;
}

function confidenceOf(table: BrandTable, brand: string) {
  return Object.entries(table.brands).find(([b]) => sameBrand(b, brand))?.[1].confidence;
}

/**
 * The one product worth considering from an unchosen brand: graded at least
 * as well as the best chosen brand, and either cheaper at an equal or better
 * score, or a better score for no more money. Null when the table is not
 * reviewed, no brands were chosen, or nothing qualifies.
 */
export function worthConsidering(
  candidates: Candidate[],
  top: Candidate | undefined,
  chosenBrands: string[],
  table: BrandTable = brandTable,
): Candidate | null {
  if (!table.reviewed || !top || chosenBrands.length === 0) return null;
  const sub = top.product.subcategoryId;
  const chosenGrade = Math.max(...chosenBrands.map((b) => gradeOf(table, b, sub) ?? 0));
  if (chosenGrade === 0) return null;
  const options = candidates.filter((c) => {
    if (chosenBrands.some((b) => sameBrand(b, c.product.brand))) return false;
    const g = gradeOf(table, c.product.brand, sub);
    if (g === null || g < chosenGrade || c.fitUnknown) return false;
    // An "at least as good" claim needs more than one thin source behind it.
    if (confidenceOf(table, c.product.brand) === "low") return false;
    return (c.score >= top.score && c.price < top.price) || (c.score > top.score && c.price <= top.price);
  });
  options.sort((a, b) => b.score - a.score || a.price - b.price);
  return options[0] ?? null;
}
