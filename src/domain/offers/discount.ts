// The "līdz −10 %" in the question before the shop (docs/PRICE_NOTIFY_PLAN.md
// §8.7). The owner set the figure (3 Nov 2026) as the most Trilio's sourced
// offers take off the shop price; change it here only together with the
// offers it describes, since an "up to" claim must be one shoppers can reach.

/** The largest discount the sheet promises, in percent of the shop price. */
export const OFFER_DISCOUNT_UP_TO_PCT = 10;

/** The most this product could cost less, rounded down so the claim never exceeds the percentage. */
export function maxOfferSavingCents(priceCents: number, pct: number = OFFER_DISCOUNT_UP_TO_PCT): number {
  if (!Number.isFinite(priceCents) || priceCents <= 0 || pct <= 0) return 0;
  return Math.floor((priceCents * pct) / 100);
}
