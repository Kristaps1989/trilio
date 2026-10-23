import { fitAttributes } from "@/domain/catalog/attributes";
import type { OfferView, ProductView, Urgency } from "@/domain/catalog/types";
import type { Answers, Subcategory } from "@/domain/questions/schema";
import {
  bestOffer,
  eligibleOffers,
  passesHardFilters,
  withinBudget,
  withinStretch,
  type PriceBounds,
} from "./filters";
import { brandPoints, specPoints, valueScore } from "./quality";
import { sameBrand, scoreProduct, type Scored } from "./score";

// Spec §3.1 and docs/FILTERS_PLAN.md §2.3 / §2.8 in one pure function.
// Input: products with all their offers, the answers, the price range,
// urgency and results-page settings. Output: up to three picks spread over
// the price range, over-budget extras, the refurbished block and the counts
// the page explains itself with. Shop commission is not an input anywhere.

export type Tier = "budget" | "mid" | "top";

export type Pick = Scored & {
  offer: OfferView;
  /** Null when the picks are too close in price for tiers to mean anything (§2.8). */
  tier: Tier | null;
  recommended: boolean;
  unconfirmed: string[];
  /** Fit-critical data missing; only shown when the user asked to see such products. */
  fitUnknown: boolean;
  /** Positive only for extras: how far over budget the best price is. */
  overBudgetByCents: number;
};

export type RefurbishedPick = Scored & {
  offer: OfferView;
  /** Best new price of the same product across all stores (any stock), for the saving line. */
  newPriceCents: number | null;
  savingVsNewCents: number | null;
  unconfirmed: string[];
};

export type RankInput = {
  products: ProductView[];
  sub: Subcategory;
  answers: Answers;
  /** Price range in cents; null = no budget. A number is an upper limit. */
  budget: PriceBounds | number;
  urgency: Urgency;
  includeRefurbished: boolean;
  /** Results-page brand preference; `brandsOnly` makes it a filter. */
  brands?: string[];
  brandsOnly?: boolean;
  /** Include products whose fit-critical data is missing (marked on the card). */
  showUnknown?: boolean;
};

export type RankResult = {
  picks: Pick[];
  extras: Pick[];
  refurbished: RefurbishedPick[];
  /** Products that passed stock + hard filters + price (the "N matching" number in the lead). */
  matchingCount: number;
  /** Products that passed stock + hard filters regardless of price. */
  eligibleCount: number;
  /** In-range products left out because the shop does not state a fit-critical value. */
  hiddenUnknownCount: number;
  /** Per question: how many in-stock products its answer excluded (the "how we filter" panel). */
  excludedBy: Record<string, number>;
  /** False when the picks are within a few percent of each other: no tier pills, "three similar options". */
  tiersMeaningful: boolean;
  /** Every other in-range product, best value first ("Rādīt vairāk variantus"). */
  more: Candidate[];
};

export type Candidate = Scored & {
  offer: OfferView;
  unconfirmed: string[];
  fitUnknown: boolean;
  price: number;
};

/**
 * Adds quality to the answer-based score: the brand's reliability for this
 * category and the specs relative to the other candidates. Applied to the
 * whole pool at once, because spec points are relative.
 */
function withQuality<T extends Candidate>(pool: T[], sub: Subcategory): T[] {
  const specs = specPoints(
    pool.map((c) => c.product),
    sub.compare,
  );
  return pool.map((c) => {
    const brand = brandPoints(c.product.brand, sub.id);
    const spec = specs.get(c.product.id) ?? 0;
    return { ...c, score: c.score + brand + spec, quality: { brand, spec } };
  });
}

function bounds(budget: RankInput["budget"]): PriceBounds {
  return typeof budget === "number" ? { max: budget } : budget;
}

type Pool = { candidates: Candidate[]; excludedBy: Record<string, number> };

function candidatesFor(input: RankInput, condition: OfferView["condition"]): Pool {
  const out: Candidate[] = [];
  const excludedBy: Record<string, number> = {};
  const range = bounds(input.budget);
  for (const p of input.products) {
    const offer = bestOffer(eligibleOffers(p, condition, input.urgency));
    if (!offer) continue;
    if (input.brandsOnly && input.brands?.length && !input.brands.some((b) => sameBrand(b, p.brand))) {
      excludedBy.$brands = (excludedBy.$brands ?? 0) + 1;
      continue;
    }
    const verdict = passesHardFilters(p, input.sub, input.answers);
    if (!verdict.pass) {
      excludedBy[verdict.failedQuestion!] = (excludedBy[verdict.failedQuestion!] ?? 0) + 1;
      continue;
    }
    const scored = scoreProduct(
      p,
      input.sub,
      input.answers,
      !withinBudget(offer.priceCents, range),
      input.brands ?? [],
    );
    out.push({
      ...scored,
      offer,
      unconfirmed: verdict.unconfirmed,
      fitUnknown: verdict.fitUnknown,
      price: offer.priceCents,
    });
  }
  return { candidates: withQuality(out, input.sub), excludedBy };
}

const byScoreThenPrice = (a: Candidate, b: Candidate) => b.score - a.score || a.price - b.price;

/**
 * Three picks that span the range (§2.3): the best overall, the best in the
 * lower third of the prices on offer and the best in the upper third. The
 * cheapest product is never picked just for being cheap, so a €89 mini fridge
 * cannot appear in a €350–500 search.
 */
/** Best value first: quality, discounted by where the price sits in the range of these candidates. */
export function byValue(candidates: Candidate[]): Candidate[] {
  const prices = candidates.map((c) => c.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const value = (c: Candidate) => valueScore(c.score, c.price, lo, hi);
  return [...candidates].sort((a, b) => value(b) - value(a) || a.price - b.price);
}

export function pickThree(candidates: Candidate[]): Candidate[] {
  const sorted = byValue(candidates);
  if (candidates.length <= 3) return sorted;
  const lo = Math.min(...candidates.map((c) => c.price));
  const hi = Math.max(...candidates.map((c) => c.price));
  const third = (hi - lo) / 3;
  const picks: Candidate[] = [sorted[0]!];
  const take = (pred: (c: Candidate) => boolean) => {
    const c = sorted.find((x) => !picks.includes(x) && pred(x));
    if (c) picks.push(c);
    return !!c;
  };
  take((c) => c.price <= lo + third);
  take((c) => c.price >= hi - third);
  while (picks.length < 3 && take(() => true));
  return picks;
}

/**
 * The upper end of the usual price range: the 75th percentile of the
 * products' prices, rounded up to whole euros. A page with no budget picks
 * within it, so a few premium models do not stretch the "budget" third into
 * premium prices (owner, 23 Oct 2026). Null with too few prices to tell.
 */
export const MAINSTREAM_PERCENTILE = 0.75;

export function mainstreamCeilingCents(prices: number[]): number | null {
  if (prices.length < 6) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const at = sorted[Math.ceil(sorted.length * MAINSTREAM_PERCENTILE) - 1]!;
  return Math.ceil(at / 100) * 100;
}

/** Neighbouring picks must differ by at least 10 % (and €5) for budget/mid/top labels to mean anything. */
export const TIER_MIN_GAP = 0.1;

export function tiersAreMeaningful(pricesAscending: number[]): boolean {
  if (pricesAscending.length < 2) return false;
  for (let i = 1; i < pricesAscending.length; i++) {
    const a = pricesAscending[i - 1]!;
    const b = pricesAscending[i]!;
    if (b - a < Math.max(500, a * TIER_MIN_GAP)) return false;
  }
  return true;
}

/** The top score must lead the next one by this much for "Trilio ieteikums" to be earned. */
export const RECOMMEND_MARGIN = 5;

/**
 * Spec §3.1 step 4 + §2.8: sort by price; tier labels only when meaningful;
 * the lime badge only on a pick that is clearly better and whose fit-critical
 * attributes are known.
 */
export function assignTiers(picks: Candidate[], sub: Subcategory): { picks: Pick[]; meaningful: boolean } {
  const sorted = [...picks].sort((a, b) => a.price - b.price);
  const meaningful = tiersAreMeaningful(sorted.map((c) => c.price));
  const tiers: Tier[] =
    sorted.length === 3 ? ["budget", "mid", "top"] : sorted.length === 2 ? ["budget", "top"] : ["mid"];
  const scores = [...sorted.map((c) => c.score)].sort((a, b) => b - a);
  const top = scores[0] ?? 0;
  const runnerUp = scores[1] ?? -Infinity;
  const fit = fitAttributes(sub.id);
  let badged = false;
  const result = sorted.map((c) => {
    const known = fit.every((k) => c.product.attributes[k] !== undefined && c.product.attributes[k] !== null);
    const recommended =
      !badged && sorted.length > 1 && c.score === top && top - runnerUp >= RECOMMEND_MARGIN && known;
    if (recommended) badged = true;
    return { ...c, tier: meaningful ? tiers[sorted.indexOf(c)]! : null, recommended, overBudgetByCents: 0 };
  });
  return { picks: result, meaningful };
}

export function rank(input: RankInput): RankResult {
  const range = bounds(input.budget);
  const pool = candidatesFor(input, "new");
  const shown = input.showUnknown ? pool.candidates : pool.candidates.filter((c) => !c.fitUnknown);
  const inBudget = shown.filter((c) => withinBudget(c.price, range));
  const hiddenUnknownCount = input.showUnknown
    ? 0
    : pool.candidates.filter((c) => c.fitUnknown && withinBudget(c.price, range)).length;
  const { picks, meaningful } = assignTiers(pickThree(inBudget), input.sub);

  // Spec §3.1 step 5: fewer than 3 in budget → at most 2 extras up to +25 % over the upper limit.
  let extras: Pick[] = [];
  if (picks.length < 3 && range?.max !== undefined) {
    const chosen = new Set(picks.map((p) => p.product.id));
    extras = shown
      .filter((c) => !chosen.has(c.product.id) && withinStretch(c.price, range.max!))
      .sort(byScoreThenPrice)
      .slice(0, 2)
      .map((c) => ({ ...c, tier: null, recommended: false, overBudgetByCents: c.price - range.max! }));
  }

  // Rule 1: refurbished never mixes with the picks; its own block, same filters, same budget.
  let refurbished: RefurbishedPick[] = [];
  if (input.includeRefurbished) {
    refurbished = candidatesFor(input, "refurbished")
      .candidates.filter((c) => (input.showUnknown || !c.fitUnknown) && withinBudget(c.price, range))
      .sort(byScoreThenPrice)
      .slice(0, 3)
      .map((c) => {
        const newBest = bestOffer(c.product.offers.filter((o) => o.condition === "new" && o.stock !== "out"));
        const newPriceCents = newBest?.priceCents ?? null;
        return {
          ...c,
          newPriceCents,
          savingVsNewCents: newPriceCents !== null ? Math.max(0, newPriceCents - c.price) : null,
        };
      });
  }

  return {
    picks,
    extras,
    refurbished,
    matchingCount: inBudget.length,
    eligibleCount: shown.length,
    hiddenUnknownCount,
    excludedBy: pool.excludedBy,
    tiersMeaningful: meaningful,
    more: byValue(inBudget).filter((c) => !picks.some((p) => p.product.id === c.product.id)),
  };
}

/**
 * How many products the answers and price range leave (live counts on every
 * screen and the relax suggestions): in stock, every hard answer met, fit data
 * known, price inside the range. The same rules as `rank`, so numbers agree.
 */
export function countMatches(
  input: Omit<RankInput, "includeRefurbished"> & { includeRefurbished?: boolean },
): number {
  const range = bounds(input.budget);
  return candidatesFor({ ...input, includeRefurbished: false }, "new").candidates.filter(
    (c) => (input.showUnknown || !c.fitUnknown) && withinBudget(c.price, range),
  ).length;
}

/**
 * Every in-stock product that meets the hard answers and has its fit data,
 * at any price, scored (advice notes and "Vērts apsvērt" look beyond the
 * price range on purpose).
 */
export function candidatePool(input: Omit<RankInput, "includeRefurbished">): Candidate[] {
  return candidatesFor({ ...input, includeRefurbished: false }, "new").candidates.filter(
    (c) => input.showUnknown || !c.fitUnknown,
  );
}
