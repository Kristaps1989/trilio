import data from "../../../data/offers.json";

// Where Trilio can make its own offer (data/offers.json). The owner's decision
// (30 Oct 2026) is every category ("*"); the file can still narrow it or leave
// categories out. There the results promise "Trilio var piedāvāt lētāk" and
// the notify consent includes Trilio's offers (docs/PRICE_NOTIFY_PLAN.md).

/**
 * Below this shop price "Iegūt lētāk" is not offered: the most it could save (10 %) is under
 * 20 €, which shoppers do not find worth a request (panel and funnel, 14 Nov 2026: no taps
 * on kettles). Such a product gets the free price alert instead.
 */
export const OFFER_ASK_MIN_PRICE_CENTS = 20_000;

export type Sourcing = { sourcing: readonly string[]; except?: readonly string[] };

export function trilioSources(subcategoryId: string, config: Sourcing = data): boolean {
  if (config.except?.includes(subcategoryId)) return false;
  return config.sourcing.includes("*") || config.sourcing.includes(subcategoryId);
}

/**
 * Whether this product's button is the request for a lower price (true) or the plain price
 * alert (false): Trilio sources the category and the price is high enough to be worth asking.
 * An unknown price keeps the category's answer.
 */
export function worthAsking(
  subcategoryId: string,
  priceCents: number | null | undefined,
  config: Sourcing = data,
): boolean {
  if (!trilioSources(subcategoryId, config)) return false;
  return priceCents == null || priceCents >= OFFER_ASK_MIN_PRICE_CENTS;
}
