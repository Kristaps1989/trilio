import type { ProductView } from "./types";

// The shops' own review scores (schema.org aggregateRating, docs/CONFIDENCE_PLAN.md B1).

export type ReviewSummary = { x10: number; count: number; shops: number };

/** At least this many shop reviews in total before a star line is shown (§3 B1). */
export const MIN_REVIEWS = 10;

/** The shops' review scores for a product, weighted by their counts; null with fewer than 10 reviews. */
export function reviewSummary(p: ProductView): ReviewSummary | null {
  let weight = 0;
  let sum = 0;
  let shops = 0;
  for (const o of p.offers) {
    if (o.condition !== "new" || !o.ratingX10 || !o.ratingCount) continue;
    weight += o.ratingCount;
    sum += o.ratingX10 * o.ratingCount;
    shops++;
  }
  if (weight < MIN_REVIEWS) return null;
  return { x10: Math.round(sum / weight), count: weight, shops };
}
