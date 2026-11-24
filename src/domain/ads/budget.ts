// The owner sets one daily budget (docs/GROWTH_PLAN.md §3, §5): code splits
// it across campaigns and paces it against the target cost per weighted
// conversion. Claude never raises the total. Money in cents.

export const MIN_CAMPAIGN_CENTS = 100;
/** A campaign budget moves at most this share in a day. */
export const MAX_DAILY_SHIFT = 0.2;
/**
 * A small budget (owner, 24 Nov 2026: 5 € a day) cannot be spread: a fifth of a 2 € campaign is
 * 40 cents, which changes nothing. Up to this total the agent may move half a campaign's budget
 * at once and switch whole campaigns off and on, so the money goes where e-mails come from.
 */
export const SMALL_BUDGET_CENTS = 1000;
export const SMALL_BUDGET_SHIFT = 0.5;

/** The share of one campaign's budget a single move may take, by the owner's daily total. */
export function maxShift(dailyBudgetCents: number | null | undefined): number {
  return dailyBudgetCents && dailyBudgetCents <= SMALL_BUDGET_CENTS ? SMALL_BUDGET_SHIFT : MAX_DAILY_SHIFT;
}

/** The click-price cap every Search campaign starts with. */
export const DEFAULT_CPC_CAP_CENTS = 30;
/** No click may be allowed to cost more than this, whatever the budget. */
export const CPC_CEILING_MAX_CENTS = 200;

/**
 * The highest click-price cap the agent may set on its own: one click never costs more than a
 * fifth of the day's budget (1 € at 5 € a day), never under the starting cap, never over 2 €.
 */
export function cpcCeilingFor(dailyBudgetCents: number): number {
  return Math.min(CPC_CEILING_MAX_CENTS, Math.max(DEFAULT_CPC_CAP_CENTS, Math.round(dailyBudgetCents * 0.2)));
}

/** Fewer impressions than this in seven days: the ads are not entering the auctions. */
export const STARVED_IMPRESSIONS_7D = 20;

/**
 * A campaign that is switched on, has money left and is hardly shown is priced out: its cap is
 * under what the searches cost. The next cap is half as much again, up to the ceiling; null
 * when the campaign is shown enough or the cap is already at the ceiling.
 */
export function starvedCap(
  input: { impressions7d: number; capCents: number },
  dailyBudgetCents: number,
): number | null {
  if (input.impressions7d >= STARVED_IMPRESSIONS_7D) return null;
  const ceiling = cpcCeilingFor(dailyBudgetCents);
  if (input.capCents >= ceiling) return null;
  return Math.min(ceiling, Math.ceil(input.capCents * 1.5));
}

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
