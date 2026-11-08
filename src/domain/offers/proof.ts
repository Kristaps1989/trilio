// Proof that "Iegūt lētāk" works (docs/UX_REVIEW_PLAN.md §6): what buyers saved
// with Trilio's own offers, against the shop price frozen when each offer was
// made. Only the category, the amount and the month are ever shown: never a
// name, a product, a shop, a date or a place, so no buyer can be recognised.

/** One paid offer: its category, what it saved against the shop, when it was paid. */
export type Saving = { subcategoryId: string; savedCents: number; paidAt: Date };

export type SavingsProof = {
  /** Paid offers that saved at least 1 €. */
  count: number;
  /** Their savings together, in whole euros (each offer rounded to the nearest euro). */
  totalCents: number;
  /** The most recent one. */
  latest: Saving;
};

/** Below this an offer is not shown as a saving. */
export const MIN_SAVING_CENTS = 100;

/** What an offer saved: the frozen shop price minus Trilio's price, times the quantity; null without a shop price. */
export function savedCents(o: {
  referencePriceCents: number | null;
  priceCents: number;
  quantity: number;
}): number | null {
  if (o.referencePriceCents === null) return null;
  return Math.max(0, o.referencePriceCents - o.priceCents) * Math.max(1, o.quantity);
}

export function savingsProof(rows: Saving[]): SavingsProof | null {
  const shown = rows
    .filter((r) => r.savedCents >= MIN_SAVING_CENTS)
    // To the nearest euro: 49,99 € reads as 50 €, never more than 50 cents off either way.
    .map((r) => ({ ...r, savedCents: Math.round(r.savedCents / 100) * 100 }))
    .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
  if (!shown.length) return null;
  return {
    count: shown.length,
    totalCents: shown.reduce((n, r) => n + r.savedCents, 0),
    latest: shown[0]!,
  };
}
