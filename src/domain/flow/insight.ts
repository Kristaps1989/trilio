import type { ProductView, Urgency } from "@/domain/catalog/types";
import { flowQuestions } from "@/domain/questions/engine";
import type { Answers, Question, Subcategory } from "@/domain/questions/schema";
import {
  bestOffer,
  eligibleOffers,
  evaluateQuestion,
  passesHardFilters,
  questionAttrs,
} from "@/domain/ranking/filters";

// What a flow screen knows from real stock (core rules 2, 4, 5 in
// docs/FILTERS_PLAN.md): how many products each answer leaves, which answer
// to pre-select, whether the question changes anything at all, and where the
// prices are. Pure; the page passes in the subcategory's products.

type Ctx = { products: ProductView[]; sub: Subcategory; answers: Answers; urgency?: Urgency };

/** In-stock new products that meet every answer so far and have their fit data. */
export function remaining({ products, sub, answers, urgency = "two_weeks" }: Ctx): ProductView[] {
  return products.filter((p) => {
    if (!bestOffer(eligibleOffers(p, "new", urgency))) return false;
    const v = passesHardFilters(p, sub, answers);
    return v.pass && !v.fitUnknown;
  });
}

/** Products each option would leave (option value → count), given the answers before this question. */
export function optionCounts(ctx: Ctx, q: Question): Record<string, number> {
  const before = remaining(ctx);
  const counts: Record<string, number> = {};
  for (const o of q.options) {
    const answers = { ...ctx.answers, [q.id]: q.type === "multi" ? [o.value] : o.value };
    counts[o.value] = o.passthrough
      ? before.length
      : before.filter((p) => evaluateQuestion(p, q, answers).result === "pass").length;
  }
  return counts;
}

/** The answer to pre-select (core rule 4): the option most products fit; ties keep data order. */
export function defaultOption(q: Question, counts: Record<string, number>): string | null {
  let best: string | null = null;
  for (const o of q.options) {
    if (o.passthrough) continue;
    if (best === null || (counts[o.value] ?? 0) > (counts[best] ?? 0)) best = o.value;
  }
  // A passthrough option ("Nezinu", "Atsevišķi") is the safe default when nothing is clearly more common.
  const pass = q.options.find((o) => o.passthrough);
  if (pass && (best === null || (counts[best] ?? 0) === 0)) return pass.value;
  return best;
}

/** Share of the remaining products that state the attributes this question needs. */
export function coverage(ctx: Ctx, q: Question): number {
  const attrs = questionAttrs(q);
  const before = remaining(ctx);
  if (attrs.length === 0 || before.length === 0) return 1;
  const known = before.filter((p) =>
    attrs.every((a) => p.attributes[a] !== undefined && p.attributes[a] !== null),
  );
  return known.length / before.length;
}

/** Below this share of products with data, asking would hide most of the stock. */
export const MIN_COVERAGE = 0.5;

/**
 * Core rule 2: skip a question whose answer would not change the products
 * shown, or that the stock's data cannot answer. Questions about the kind of
 * product ("kind") are kept even when stock is thin, because they change
 * what we recommend, not just what we filter.
 */
export function questionMatters(ctx: Ctx, q: Question): boolean {
  if (q.type === "range" || q.type === "number") return coverage(ctx, q) >= MIN_COVERAGE;
  const before = remaining(ctx);
  if (before.length === 0) return true; // nothing in stock: still ask, the dead-end prompt explains
  if (q.hard_filter && coverage(ctx, q) < MIN_COVERAGE) return false;
  // A soft question without conditions changes the advice, not the stock (coffee cups per day).
  if (!q.hard_filter && q.options.every((o) => !o.match)) return true;
  const counts = optionCounts(ctx, q);
  const real = q.options.filter((o) => !o.passthrough);
  // Every option leaves the same products: the answer changes nothing.
  const distinct = new Set(real.map((o) => counts[o.value] ?? 0));
  if (distinct.size === 1 && (counts[real[0]!.value] ?? 0) === before.length) return false;
  return true;
}

/** Flow questions in order, minus those that do not matter now (for progress and "next"). */
export function questionsThatMatter(ctx: Ctx): Question[] {
  const out: Question[] = [];
  const answers: Answers = {};
  for (const q of flowQuestions(ctx.sub, ctx.answers)) {
    if (ctx.answers[q.id] !== undefined || questionMatters({ ...ctx, answers }, q)) out.push(q);
    if (ctx.answers[q.id] !== undefined) answers[q.id] = ctx.answers[q.id]!;
  }
  return out;
}

export type PriceStats = {
  count: number;
  minCents: number;
  maxCents: number;
  /** Ten equal-width buckets from min to max: product counts for the histogram. */
  buckets: number[];
  /** Pre-selected range: the middle 60 % of prices, rounded outward to €10. */
  defaultMinCents: number;
  defaultMaxCents: number;
};

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i]!;
}

/** Prices of the products the answers leave (best in-stock new offer each). */
export function priceStats(ctx: Ctx): PriceStats | null {
  const prices = remaining(ctx)
    .map((p) => bestOffer(eligibleOffers(p, "new", ctx.urgency ?? "two_weeks"))!.priceCents)
    .sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const min = prices[0]!;
  const max = prices[prices.length - 1]!;
  const width = Math.max(1, (max - min) / 10);
  const buckets = Array.from({ length: 10 }, () => 0);
  for (const p of prices) buckets[Math.min(9, Math.floor((p - min) / width))]!++;
  const step = 1000;
  return {
    count: prices.length,
    minCents: min,
    maxCents: max,
    buckets,
    defaultMinCents: Math.floor(percentile(prices, 0.2) / step) * step,
    defaultMaxCents: Math.ceil(percentile(prices, 0.8) / step) * step,
  };
}
