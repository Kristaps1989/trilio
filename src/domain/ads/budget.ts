// The owner sets one daily budget (docs/GROWTH_PLAN.md §3, §5): code splits
// it across campaigns and paces it against the target cost per weighted
// conversion. Claude never raises the total. Money in cents.

export const MIN_CAMPAIGN_CENTS = 100;
/** A campaign budget moves at most this share in a day. */
export const MAX_DAILY_SHIFT = 0.2;

/** Splits `total` by weight, every share at least MIN_CAMPAIGN_CENTS when the total allows, the sum exactly `total`. */
export function splitBudget(total: number, weights: Record<string, number>): Record<string, number> {
  const ids = Object.keys(weights);
  if (ids.length === 0) return {};
  const w = (id: string) => Math.max(0, weights[id] ?? 0);
  const sum = ids.reduce((a, id) => a + w(id), 0);
  const share = (id: string) => (sum > 0 ? w(id) / sum : 1 / ids.length);
  const floor = Math.min(MIN_CAMPAIGN_CENTS, Math.floor(total / ids.length));
  const rest = total - floor * ids.length;
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = floor + Math.floor(rest * share(id));
  // Rounding leftovers go to the heaviest campaign.
  const top = [...ids].sort((a, b) => w(b) - w(a))[0]!;
  out[top]! += total - Object.values(out).reduce((a, b) => a + b, 0);
  return out;
}

export type Performance = {
  /** Spend over the last 7 days, in cents. */
  cost7dCents: number;
  shopClicks7d: number;
  saves7d: number;
};

export type PacingSettings = {
  dailyBudgetCents: number;
  floorCents: number;
  targetCostCents: number | null;
  clickWeight: number;
  saveWeight: number;
};

export function weightedConversions(
  p: Performance,
  s: Pick<PacingSettings, "clickWeight" | "saveWeight">,
): number {
  return p.shopClicks7d * s.clickWeight + p.saves7d * s.saveWeight;
}

/** Cost per weighted conversion over 7 days, or null with no conversions. */
export function costPerConversion(p: Performance, s: PacingSettings): number | null {
  const conv = weightedConversions(p, s);
  return conv > 0 ? Math.round(p.cost7dCents / conv) : null;
}

/**
 * Tomorrow's total daily budget: the owner's number while there is no target
 * or the target is met; 20 % less (down to the floor) while it is missed;
 * back up 20 % a day, never above the owner's number, once it is met again.
 */
export function pacedBudget(
  current: number,
  p: Performance,
  s: PacingSettings,
): { cents: number; why: string } {
  const owner = s.dailyBudgetCents;
  if (s.targetCostCents === null) return { cents: owner, why: "no target set" };
  // A week with too little spend says nothing yet.
  if (p.cost7dCents < s.targetCostCents * 3)
    return { cents: Math.min(current || owner, owner), why: "too little data" };
  const cpc = costPerConversion(p, s);
  const missed = cpc === null || cpc > s.targetCostCents;
  if (missed) {
    const cents = Math.max(
      s.floorCents,
      Math.round(Math.min(current || owner, owner) * (1 - MAX_DAILY_SHIFT)),
    );
    return {
      cents,
      why: cpc === null ? "no conversions in 7 days" : `cost per conversion ${cpc} over target`,
    };
  }
  return {
    cents: Math.min(owner, Math.round((current || owner) * (1 + MAX_DAILY_SHIFT))),
    why: "target met",
  };
}
