import type { OfferView, ProductView } from "@/domain/catalog/types";
import { priceRange, type FlowState } from "@/domain/flow/state";
import type { Subcategory } from "@/domain/questions/schema";
import { bestOffer, eligibleOffers } from "@/domain/ranking/filters";
import { rank, type RankInput } from "@/domain/ranking/rank";

// Wishlist ("Vēlmju saraksts", owner 20 Oct 2026). A heart saves a product
// or a whole search; the list is free and shows the current best offer and
// the price history. The paid service e-mails one daily digest of drops.
// Pure: the job and the page feed it products; it never reads the database.

export type Threshold = "any" | "5" | "10";

/** One save per thing per user: the database's unique key. */
export const productKey = (productId: string) => `p:${productId}`;
export const searchKey = (subcategoryId: string, answersParam: string) =>
  `s:${subcategoryId}:${answersParam}`;

/** At most one e-mail line per saved item a day, however often prices move. */
export const DEBOUNCE_MS = 24 * 3600 * 1000;

/** True when the new price is a drop that counts for the user's threshold. */
export function dropMet(threshold: Threshold, oldCents: number, newCents: number): boolean {
  if (newCents >= oldCents) return false;
  if (threshold === "any") return true;
  return ((oldCents - newCents) / oldCents) * 100 >= Number(threshold);
}

/** The product's best new offer that can arrive within two weeks (what a card shows). */
export function currentOffer(product: ProductView): OfferView | null {
  return bestOffer(eligibleOffers(product, "new", "two_weeks"));
}

/** The ranking input a saved search stands for (the same as the results page). */
export function rankInputFromState(products: ProductView[], sub: Subcategory, state: FlowState): RankInput {
  return {
    products,
    sub,
    answers: state.answers,
    budget: priceRange(state),
    urgency: state.trailing.urgency ?? "two_weeks",
    brands: state.trailing.brands,
    brandsOnly: state.trailing.brandsOnly,
    showUnknown: state.trailing.showUnknown,
    includeRefurbished: false,
  };
}

export type SearchProposal = {
  /** The recommended pick today ("Tava izvēle"), or null when nothing fits any more. */
  top: { product: ProductView; offer: OfferView } | null;
  /** How many products fit the saved answers and price range today. */
  matchingCount: number;
};

/** What a saved search proposes today. */
export function searchProposal(products: ProductView[], sub: Subcategory, state: FlowState): SearchProposal {
  const r = rank(rankInputFromState(products, sub, state));
  const top = r.picks.find((p) => p.recommended) ?? r.picks[0] ?? null;
  return { top: top ? { product: top.product, offer: top.offer } : null, matchingCount: r.matchingCount };
}

export type ItemState = { baselinePriceCents: number | null; lastNotifiedAt: Date | null };

export type WishlistEvent = {
  itemId: string;
  kind: "product" | "search";
  productId: string;
  offerId: string;
  oldPriceCents: number;
  newPriceCents: number;
};

/**
 * Whether a saved item goes into today's digest: its current price (a
 * product's best offer, or a search's recommended pick) dropped enough below
 * the baseline, and it was not mentioned in the last day.
 */
export function evaluateItem(
  item: ItemState & { id: string; kind: "product" | "search" },
  current: { productId: string; offer: OfferView } | null,
  threshold: Threshold,
  now = new Date(),
): WishlistEvent | null {
  if (!current || item.baselinePriceCents === null) return null;
  if (item.lastNotifiedAt && now.getTime() - item.lastNotifiedAt.getTime() < DEBOUNCE_MS) return null;
  if (!dropMet(threshold, item.baselinePriceCents, current.offer.priceCents)) return null;
  return {
    itemId: item.id,
    kind: item.kind,
    productId: current.productId,
    offerId: current.offer.id,
    oldPriceCents: item.baselinePriceCents,
    newPriceCents: current.offer.priceCents,
  };
}

/** Lowest price per day for the history chart; days without a snapshot are left out. */
export function dailyLows(
  points: { day: string; priceCents: number }[],
): { day: string; priceCents: number }[] {
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(p.day, Math.min(byDay.get(p.day) ?? Infinity, p.priceCents));
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, priceCents]) => ({ day, priceCents }));
}
