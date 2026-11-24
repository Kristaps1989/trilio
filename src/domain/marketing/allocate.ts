// One daily budget for every paid channel (owner, 24 Nov 2026: 5 € a day for Google and Meta
// together, spent where e-mails come from). Pure rules, in cents: how the day's total is
// split between the channels, how Meta's share is spread over what holds a budget there,
// and which Meta ad has had its chance. Code decides these, not Claude: the numbers are
// small and the rules have to be the same every day.

export type ChannelId = "google" | "meta";

export type ChannelPerformance = {
  id: ChannelId;
  /** Ads can run there now: at least one campaign is switched on. */
  active: boolean;
  /** The channel's share of the budget today. */
  currentCents: number;
  /** The last 28 days: what was spent and how many e-mails its visitors left. */
  spendCents: number;
  leads: number;
};

/** No running channel is left with less than this share: without spend it can never show a result. */
export const MIN_CHANNEL_SHARE = 0.3;
/** The split moves by at most this share of the total in a day. */
export const MAX_SPLIT_STEP = 0.2;
/** A channel that runs gets at least this much a day. */
export const MIN_CHANNEL_CENTS = 100;
/**
 * What a channel is assumed to do before it has shown anything: one e-mail per 10 € spent.
 * Added to both sides of the division, so a channel with 2 € spent and no e-mail is not
 * written off, and one lucky e-mail does not take the whole budget.
 */
const PRIOR = { leads: 1, cents: 1000 };

/** E-mails per euro, smoothed with the prior. */
export function leadRate(p: Pick<ChannelPerformance, "spendCents" | "leads">): number {
  return (p.leads + PRIOR.leads) / ((p.spendCents + PRIOR.cents) / 100);
}

/**
 * Splits the owner's daily total between the channels. A channel that cannot run gets
 * nothing; a single running one gets everything. Two running ones share by e-mails per euro
 * over 28 days, each keeping at least 30 % (and 1 €), and the split moves at most a fifth of
 * the total from where it stands today. The parts always add up to the total.
 */
export function splitChannels(totalCents: number, channels: ChannelPerformance[]): Record<ChannelId, number> {
  const out: Record<ChannelId, number> = { google: 0, meta: 0 };
  const running = channels.filter((c) => c.active);
  if (totalCents <= 0 || running.length === 0) return out;
  if (running.length === 1) {
    out[running[0]!.id] = totalCents;
    return out;
  }
  const [a, b] = running as [ChannelPerformance, ChannelPerformance];
  const rateA = leadRate(a);
  const rateB = leadRate(b);
  let shareA = rateA / (rateA + rateB);
  shareA = Math.min(1 - MIN_CHANNEL_SHARE, Math.max(MIN_CHANNEL_SHARE, shareA));
  let centsA = Math.round(totalCents * shareA);
  // From where it stands today, when today's split is a split of this total.
  const current = a.currentCents + b.currentCents;
  if (current === totalCents && b.currentCents > 0 && a.currentCents > 0) {
    const step = Math.max(1, Math.round(totalCents * MAX_SPLIT_STEP));
    centsA = Math.min(a.currentCents + step, Math.max(a.currentCents - step, centsA));
  }
  // Each side at least 1 €, when the total allows two such parts.
  if (totalCents >= 2 * MIN_CHANNEL_CENTS)
    centsA = Math.min(totalCents - MIN_CHANNEL_CENTS, Math.max(MIN_CHANNEL_CENTS, centsA));
  out[a.id] = centsA;
  out[b.id] = totalCents - centsA;
  return out;
}

export type BudgetHolder = {
  /** Meta's id of the campaign or ad set that carries a daily budget. */
  id: string;
  dailyBudgetCents: number;
  /** The last 28 days. */
  spendCents: number;
  leads: number;
};

/** Meta does not run a budget under this; 1 € a day is the smallest amount set. */
export const MIN_META_BUDGET_CENTS = 100;

/**
 * Spreads Meta's share over the campaigns or ad sets that carry a budget. Each gets at least
 * 1 €; when the share cannot give every one that, the ones with the best e-mails per euro keep
 * a budget and the rest are to be paused (`pause`). Among those that stay, the share is split
 * by e-mails per euro. The budgets add up to the share exactly.
 */
export function planMetaBudgets(
  shareCents: number,
  holders: BudgetHolder[],
): { budgets: Record<string, number>; pause: string[] } {
  if (holders.length === 0) return { budgets: {}, pause: [] };
  const ranked = [...holders].sort(
    (x, y) =>
      leadRate(y) - leadRate(x) || y.dailyBudgetCents - x.dailyBudgetCents || x.id.localeCompare(y.id),
  );
  const room = Math.max(0, Math.floor(shareCents / MIN_META_BUDGET_CENTS));
  const keep = ranked.slice(0, Math.min(ranked.length, room));
  const pause = ranked.slice(keep.length).map((h) => h.id);
  if (keep.length === 0) return { budgets: {}, pause };
  const rest = shareCents - keep.length * MIN_META_BUDGET_CENTS;
  const sum = keep.reduce((n, h) => n + leadRate(h), 0);
  const budgets: Record<string, number> = {};
  for (const h of keep) budgets[h.id] = MIN_META_BUDGET_CENTS + Math.floor((rest * leadRate(h)) / sum);
  // Rounding leftovers go to the best one.
  budgets[keep[0]!.id]! += shareCents - Object.values(budgets).reduce((n, c) => n + c, 0);
  return { budgets, pause };
}

export type AdResult = {
  id: string;
  adsetId: string;
  /** Running now. */
  active: boolean;
  /** The last 14 days. */
  spendCents: number;
  leads: number;
};

/** An ad has had its chance once it spent this much in 14 days without an e-mail. */
export const AD_TRIAL_CENTS = 500;

/**
 * The Meta ads to pause: running, 5 € or more spent in 14 days, no e-mail left by their
 * visitors, and not the last running ad of their ad set (an ad set with no ad spends nothing
 * and tells nothing). In an ad set the one that spent most goes first, one per ad set a day.
 */
export function adsToPause(ads: AdResult[]): string[] {
  const out: string[] = [];
  const bySet = new Map<string, AdResult[]>();
  for (const ad of ads.filter((a) => a.active)) bySet.set(ad.adsetId, [...(bySet.get(ad.adsetId) ?? []), ad]);
  for (const running of bySet.values()) {
    if (running.length < 2) continue;
    const spent = running
      .filter((a) => a.leads === 0 && a.spendCents >= AD_TRIAL_CENTS)
      .sort((x, y) => y.spendCents - x.spendCents || x.id.localeCompare(y.id));
    if (spent[0]) out.push(spent[0].id);
  }
  return out;
}
