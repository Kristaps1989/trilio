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

/**
 * The attributes every option of a choice depends on (vacuum type for robot /
 * robot that mops / cordless / corded); an attribute only one option adds
 * (mopping) does not decide whether the question can be answered.
 */
export function coreAttrs(q: Question): string[] {
  if (q.type === "range" || q.type === "number") return questionAttrs(q);
  const sets = q.options
    .filter((o) => !o.passthrough && o.match?.length)
    .map((o) => new Set(o.match!.map((m) => m.attr)));
  if (sets.length === 0) return [];
  const shared = [...sets[0]!].filter((a) => sets.every((s) => s.has(a)));
  return shared.length ? shared : questionAttrs(q);
}

/** Share of the remaining products that state the attributes this question needs. */
export function coverage(ctx: Ctx, q: Question): number {
  const attrs = coreAttrs(q);
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
  // Only one option is possible and it keeps everything: there is nothing to choose.
  const possible = real.filter((o) => (counts[o.value] ?? 0) > 0);
  if (possible.length === 1 && counts[possible[0]!.value] === before.length) return false;
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
  /**
   * Right end of the slider and histogram: the 95th percentile, so one
   * €5 000 outlier does not squeeze every other price into the first bar.
   * Higher limits are typed or reached with the "+" buttons.
   */
  scaleMaxCents: number;
  /** Ten equal-width buckets from min to scaleMax (outliers in the last one): counts for the histogram. */
  buckets: number[];
  /** Pre-selected range: around the typical price of the category (30th–70th percentile), rounded. */
  defaultMinCents: number;
  defaultMaxCents: number;
  /** Rounding step: €5 for cheap categories, €10 otherwise. */
  stepCents: number;
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
  const step = percentile(prices, 0.5) < 10_000 ? 500 : 1000;
  const floor = (c: number) => Math.floor(c / step) * step;
  const ceil = (c: number) => Math.ceil(c / step) * step;
  const scaleMax = Math.max(ceil(percentile(prices, 0.95)), floor(min) + step);
  const width = Math.max(1, (scaleMax - min) / 10);
  const buckets = Array.from({ length: 10 }, () => 0);
  for (const p of prices) buckets[Math.min(9, Math.max(0, Math.floor((p - min) / width)))]!++;
  const defaultMin = floor(percentile(prices, 0.3));
  return {
    count: prices.length,
    minCents: min,
    maxCents: max,
    scaleMaxCents: scaleMax,
    buckets,
    defaultMinCents: defaultMin,
    defaultMaxCents: Math.max(defaultMin + step, ceil(percentile(prices, 0.7))),
    stepCents: step,
  };
}
