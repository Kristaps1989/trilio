import type { OfferView, ProductView, Urgency } from "@/domain/catalog/types";
import type { Answers, Subcategory } from "@/domain/questions/schema";
import { bestOffer, eligibleOffers, passesHardFilters, withinBudget, withinStretch } from "./filters";
import { scoreProduct, type Scored } from "./score";

// Spec §3.1 steps 1–6 in one pure function. Input: products with all their
// offers (both conditions), the answers, budget and urgency. Output: the
// three picks with tiers, over-budget extras, the refurbished block, and
// counts for the lead text. Shop commission is not an input anywhere here.

export type Tier = "budget" | "mid" | "top";

export type Pick = Scored & {
  offer: OfferView;
  tier: Tier;
  recommended: boolean;
  unconfirmed: string[];
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
  budgetCents: number | null;
  urgency: Urgency;
  includeRefurbished: boolean;
};

export type RankResult = {
  picks: Pick[];
  extras: Pick[];
  refurbished: RefurbishedPick[];
  /** Products that passed stock + hard filters + budget (the "N matching" number in the lead). */
  matchingCount: number;
  /** Products that passed stock + hard filters regardless of budget. */
  eligibleCount: number;
};

type Candidate = Scored & { offer: OfferView; unconfirmed: string[]; price: number };

function candidatesFor(input: RankInput, condition: OfferView["condition"]): Candidate[] {
  const out: Candidate[] = [];
  for (const p of input.products) {
    const offer = bestOffer(eligibleOffers(p, condition, input.urgency));
    if (!offer) continue;
    const verdict = passesHardFilters(p, input.sub, input.answers);
    if (!verdict.pass) continue;
    const scored = scoreProduct(
      p,
      input.sub,
      input.answers,
      !withinBudget(offer.priceCents, input.budgetCents),
    );
    out.push({ ...scored, offer, unconfirmed: verdict.unconfirmed, price: offer.priceCents });
  }
  return out;
}

const byScoreThenPrice = (a: Candidate, b: Candidate) => b.score - a.score || a.price - b.price;

/** Spec §3.1 step 3: best score, cheapest of the rest, best remaining by score. */
export function pickThree(candidates: Candidate[]): Candidate[] {
  const pool = [...candidates].sort(byScoreThenPrice);
  const picks: Candidate[] = [];
  const first = pool.shift();
  if (!first) return picks;
  picks.push(first);
  if (pool.length) {
    const cheapest = pool.reduce((m, c) => (c.price < m.price ? c : m));
    picks.push(cheapest);
    pool.splice(pool.indexOf(cheapest), 1);
  }
  if (pool.length) picks.push(pool[0]!);
  return picks;
}

/** Spec §3.1 step 4: sort by price, label tiers; the lime badge goes on the highest score. */
export function assignTiers(picks: Candidate[]): Pick[] {
  const sorted = [...picks].sort((a, b) => a.price - b.price);
  const tiers: Tier[] =
    sorted.length === 3 ? ["budget", "mid", "top"] : sorted.length === 2 ? ["budget", "top"] : ["mid"];
  const topScore = Math.max(...sorted.map((p) => p.score));
  let badged = false;
  return sorted.map((c, i) => {
    const recommended = !badged && c.score === topScore;
    if (recommended) badged = true;
    return { ...c, tier: tiers[i]!, recommended, overBudgetByCents: 0 };
  });
}

export function rank(input: RankInput): RankResult {
  const all = candidatesFor(input, "new");
  const inBudget = all.filter((c) => withinBudget(c.price, input.budgetCents));
  const picked = pickThree(inBudget);
  const picks = assignTiers(picked);

  // Spec §3.1 step 5: fewer than 3 in budget → at most 2 extras up to +25 %.
  let extras: Pick[] = [];
  if (picks.length < 3 && input.budgetCents !== null) {
    const chosen = new Set(picks.map((p) => p.product.id));
    extras = all
      .filter((c) => !chosen.has(c.product.id) && withinStretch(c.price, input.budgetCents!))
      .sort(byScoreThenPrice)
      .slice(0, 2)
      .map((c) => ({
        ...c,
        tier: "top" as const,
        recommended: false,
        overBudgetByCents: c.price - input.budgetCents!,
      }));
  }

  // Rule 1: refurbished never mixes with the picks; its own block, same filters, same budget.
  let refurbished: RefurbishedPick[] = [];
  if (input.includeRefurbished) {
    refurbished = candidatesFor(input, "refurbished")
      .filter((c) => withinBudget(c.price, input.budgetCents))
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

  return { picks, extras, refurbished, matchingCount: inBudget.length, eligibleCount: all.length };
}
