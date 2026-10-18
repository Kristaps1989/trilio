import { fitAttributes } from "@/domain/catalog/attributes";
import { matchAll, unknownAttrs } from "@/domain/catalog/match";
import { numberAttr, type OfferView, type ProductView, type Urgency } from "@/domain/catalog/types";
import { activeOptions, isRangeAnswer, visibleQuestions } from "@/domain/questions/engine";
import type { Answers, Question, Subcategory } from "@/domain/questions/schema";

// Spec §3.1 step 1 and docs/FILTERS_PLAN.md §2.1–2.2: in stock (per urgency),
// every hard answer satisfied, price inside the range.
//
// A hard answer has three outcomes per product: it holds, it is contradicted,
// or the product does not state the attribute. Contradicted products are out.
// Unknown on a fit-critical attribute (size, form, install) also keeps the
// product out of the picks, because a wrong size is a return; such products
// are counted so the page can offer to show them. Unknown on anything else is
// shown on the card as "nav zināms: …".

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

export type QuestionVerdict = { result: "pass" | "fail" | "unknown"; unknown: string[] };

/** Attribute a question constrains (for fit-criticality), if any. */
export function questionAttrs(q: Question): string[] {
  if (q.type === "range") return [q.range!.attr];
  if (q.type === "number") return q.input?.attr ? [q.input.attr] : [];
  return [...new Set(q.options.flatMap((o) => (o.match ?? []).map((m) => m.attr)))];
}

/** Option values of a question that appear in the product's tags (legacy data without attributes). */
function productTagsFor(q: Question, p: ProductView): string[] {
  const values = new Set(q.options.map((o) => o.value));
  return p.tags.filter((t) => values.has(t));
}

/** One question against one product. Questions without an answer, or with a passthrough answer, pass. */
export function evaluateQuestion(p: ProductView, q: Question, answers: Answers): QuestionVerdict {
  const answer = answers[q.id];
  if (answer === undefined) return { result: "pass", unknown: [] };

  if (q.type === "range") {
    if (!isRangeAnswer(answer)) return { result: "pass", unknown: [] };
    const r = q.range!;
    if (answer.min === undefined && answer.max === undefined) return { result: "pass", unknown: [] };
    const v = numberAttr(p, r.attr);
    if (v === null) return { result: "unknown", unknown: [r.attr] };
    const tol = r.toleranceAbove ?? 0;
    if (answer.max !== undefined && v > answer.max + tol) return { result: "fail", unknown: [] };
    if (answer.min !== undefined && v < answer.min) return { result: "fail", unknown: [] };
    return { result: "pass", unknown: [] };
  }

  if (q.type === "number") {
    const input = q.input;
    if (!input?.attr || typeof answer !== "number") return { result: "pass", unknown: [] };
    const v = numberAttr(p, input.attr);
    if (v === null) return { result: "unknown", unknown: [input.attr] };
    if (v > answer + (input.toleranceAbove ?? 0) || v < answer - (input.toleranceBelow ?? 0)) {
      return { result: "fail", unknown: [] };
    }
    return { result: "pass", unknown: [] };
  }

  const chosen = activeOptions(q, answers);
  if (chosen.length === 0) return { result: "pass", unknown: [] }; // passthrough answer
  // Attribute conditions: a single answer must hold; for multi, every chosen requirement must hold.
  // Options without conditions (e.g. coffee cups per day, used for advice only) constrain nothing.
  const conditioned = chosen.filter((o) => o.match);
  if (conditioned.length > 0) {
    let unknown = false;
    const missing = new Set<string>();
    for (const o of conditioned) {
      const r = matchAll(p, o.match!);
      if (r === false) return { result: "fail", unknown: [] };
      if (r === null) {
        unknown = true;
        unknownAttrs(p, o.match!).forEach((a) => missing.add(a));
      }
    }
    return unknown ? { result: "unknown", unknown: [...missing] } : { result: "pass", unknown: [] };
  }
  // Legacy: option values carried as product tags (rows from before data/attributes.json).
  const has = productTagsFor(q, p);
  if (has.length === 0) return { result: "pass", unknown: [] };
  return chosen.every((o) => has.includes(o.value))
    ? { result: "pass", unknown: [] }
    : { result: "fail", unknown: [] };
}

export type HardFilterVerdict = {
  pass: boolean;
  /** Fit-critical data missing: not a pick unless the user asks to see such products. */
  fitUnknown: boolean;
  /** Attribute keys (or question ids for legacy data) the product does not state; shown as "nav zināms". */
  unconfirmed: string[];
  /** Question that excluded the product, for the "how we filter" counts. */
  failedQuestion?: string;
};

export function passesHardFilters(p: ProductView, sub: Subcategory, answers: Answers): HardFilterVerdict {
  const unconfirmed: string[] = [];
  const fit = new Set(fitAttributes(sub.id));
  let fitUnknown = false;
  for (const q of visibleQuestions(sub, answers)) {
    if (!q.hard_filter || answers[q.id] === undefined) continue;
    const v = evaluateQuestion(p, q, answers);
    if (v.result === "fail") return { pass: false, fitUnknown: false, unconfirmed, failedQuestion: q.id };
    if (v.result === "unknown") {
      const critical = q.up_front_reason === "fit" || v.unknown.some((a) => fit.has(a));
      if (critical) fitUnknown = true;
      unconfirmed.push(...v.unknown);
    }
  }
  return { pass: true, fitUnknown, unconfirmed: [...new Set(unconfirmed)] };
}

export type PriceBounds = { min?: number; max?: number } | null;

export function withinBudget(priceCents: number, range: PriceBounds | number): boolean {
  const r = typeof range === "number" ? { max: range } : range;
  if (!r) return true;
  if (r.max !== undefined && priceCents > r.max) return false;
  if (r.min !== undefined && priceCents < r.min) return false;
  return true;
}

/** Rule 2: extras may cost at most 25 % over the budget's upper limit. */
export function withinStretch(priceCents: number, budgetMaxCents: number): boolean {
  return priceCents > budgetMaxCents && priceCents <= Math.floor(budgetMaxCents * 1.25);
}
