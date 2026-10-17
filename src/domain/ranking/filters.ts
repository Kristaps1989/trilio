import { numberAttr, type OfferView, type ProductView, type Urgency } from "@/domain/catalog/types";
import { activeOptions, visibleQuestions } from "@/domain/questions/engine";
import type { Answers, Question, Subcategory } from "@/domain/questions/schema";

// Spec §3.1 step 1: in stock (per urgency), matches all hard filters, price ≤ budget.
// A hard filter excludes products that CONTRADICT the answer; products whose
// data does not cover the question pass with an "unconfirmed" note
// (docs/QUESTION_SCHEMA.md).

/** Number questions compare an attribute with a tolerance; keyed by subcategory and question id. */
const NUMBER_FILTERS: Record<string, { attr: string; toleranceBelow: number; toleranceAbove: number }> = {
  "fridge.niche": { attr: "height_cm", toleranceBelow: 6, toleranceAbove: 0.5 },
  "freezer.niche": { attr: "height_cm", toleranceBelow: 6, toleranceAbove: 0.5 },
};

export function stockAllowed(stock: OfferView["stock"], urgency: Urgency): boolean {
  if (stock === "out") return false;
  if (urgency === "asap") return stock === "in";
  return true;
}

/** Offers that can be bought now given the urgency; never mixes conditions. */
export function eligibleOffers(
  p: ProductView,
  condition: OfferView["condition"],
  urgency: Urgency,
): OfferView[] {
  return p.offers.filter((o) => o.condition === condition && stockAllowed(o.stock, urgency));
}

export function bestOffer(offers: OfferView[]): OfferView | null {
  let best: OfferView | null = null;
  for (const o of offers) if (!best || o.priceCents < best.priceCents) best = o;
  return best;
}

export type HardFilterVerdict = { pass: boolean; unconfirmed: string[] };

/** Option values of a question that appear in the product's tags. */
function productTagsFor(q: Question, p: ProductView): string[] {
  const values = new Set(q.options.map((o) => o.value));
  return p.tags.filter((t) => values.has(t));
}

export function passesHardFilters(p: ProductView, sub: Subcategory, answers: Answers): HardFilterVerdict {
  const unconfirmed: string[] = [];
  for (const q of visibleQuestions(sub, answers)) {
    if (!q.hard_filter || answers[q.id] === undefined) continue;

    if (q.type === "number") {
      const rule = NUMBER_FILTERS[`${sub.id}.${q.id}`];
      const wanted = answers[q.id];
      if (!rule || typeof wanted !== "number") continue;
      const actual = numberAttr(p, rule.attr);
      if (actual === null) {
        unconfirmed.push(q.id);
        continue;
      }
      if (actual > wanted + rule.toleranceAbove || actual < wanted - rule.toleranceBelow) {
        return { pass: false, unconfirmed };
      }
      continue;
    }

    const chosen = activeOptions(q, answers).map((o) => o.value);
    if (chosen.length === 0) continue; // passthrough answer
    const has = productTagsFor(q, p);
    if (has.length === 0) {
      unconfirmed.push(q.id);
      continue;
    }
    // Multi: every chosen value must be present (it is a requirement list). Single: the one value.
    if (!chosen.every((v) => has.includes(v))) return { pass: false, unconfirmed };
  }
  return { pass: true, unconfirmed };
}

export function withinBudget(priceCents: number, budgetCents: number | null): boolean {
  return budgetCents === null || priceCents <= budgetCents;
}

/** Rule 2: extras may cost at most 25 % over budget. */
export function withinStretch(priceCents: number, budgetCents: number): boolean {
  return priceCents > budgetCents && priceCents <= Math.floor(budgetCents * 1.25);
}
