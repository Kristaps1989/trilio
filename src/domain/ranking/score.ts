import type { ProductView } from "@/domain/catalog/types";
import { activeOptions, visibleQuestions } from "@/domain/questions/engine";
import type { Answers, Option, Subcategory } from "@/domain/questions/schema";

// Spec §3.1 step 2: base rating × 10 (rating is stored 0–100, which already
// is s × 10), +12 per matched soft answer; priorities weigh the first pick
// higher; −40 when over budget (only matters for extras). Deterministic and
// explainable: every point comes with the option that earned it.

export const SOFT_MATCH_POINTS = 12;
export const PRIORITY_POINTS = [15, 12] as const;
export const OVER_BUDGET_PENALTY = 40;
export const DEFAULT_RATING = 70;

export type ScoreReason = { questionId: string; option: Option; points: number };

export type Scored = {
  product: ProductView;
  score: number;
  reasons: ScoreReason[];
};

/** Answer matches: the option is chosen, not passthrough, and the product carries its tag. Hard-filter matches carry 0 points. */
export function matchedOptions(p: ProductView, sub: Subcategory, answers: Answers): ScoreReason[] {
  const reasons: ScoreReason[] = [];
  const tags = new Set(p.tags);
  for (const q of visibleQuestions(sub, answers)) {
    if (q.type === "number") continue;
    const chosen = activeOptions(q, answers);
    chosen.forEach((o, i) => {
      if (!tags.has(o.value)) return;
      // Hard-filter matches explain the fit (card reasons) but earn no points: filtering is not ranking.
      const points = q.hard_filter
        ? 0
        : q.id === "priorities"
          ? (PRIORITY_POINTS[i] ?? PRIORITY_POINTS[1])
          : SOFT_MATCH_POINTS;
      reasons.push({ questionId: q.id, option: o, points });
    });
  }
  return reasons;
}

export function scoreProduct(p: ProductView, sub: Subcategory, answers: Answers, overBudget = false): Scored {
  const reasons = matchedOptions(p, sub, answers);
  let score = p.rating ?? DEFAULT_RATING;
  for (const r of reasons) score += r.points;
  if (overBudget) score -= OVER_BUDGET_PENALTY;
  return { product: p, score, reasons };
}

/** Up to three "why it fits" lines, from matched options that have a card reason. */
export function whyItFits(reasons: ScoreReason[], max = 3): string[] {
  const out: string[] = [];
  for (const r of [...reasons].sort((a, b) => b.points - a.points)) {
    const text = r.option.card_reason;
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}
