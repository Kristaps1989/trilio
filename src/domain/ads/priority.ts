import { BRAND_GROUP, COMPETITOR_GROUP } from "./plan";

// Which campaigns to switch on first (owner, 14 Nov 2026). Deterministic and explainable:
// every recommendation carries the numbers it rests on. Search best practice for a small
// account is concentration: a few campaigns with enough budget to learn from, not every
// category on a few cents a day.

export type CampaignFacts = {
  id: string;
  name: string;
  kind: "search" | "pmax";
  groupId: string;
  status: string;
  /** Google's figures for the last 28 days. */
  adClicks: number;
  costCents: number;
  /** What ad visitors did on Trilio in the last 28 days: shop clicks and saves or requests. */
  outcomes: number;
  /** People's searches on Trilio in this group in the last 30 days, from every channel. */
  siteSearches: number;
  /** Trilio sources this group itself, so a request can become a sale. */
  sourced: boolean;
};

export type Tier = "now" | "next" | "wait";
export type Reason =
  | "brand"
  | "proven"
  | "demand"
  | "sourced_demand"
  | "low_demand"
  | "no_budget"
  | "competitor"
  | "pmax_needs_conversions"
  | "pmax_ready";

export type Recommendation = {
  id: string;
  name: string;
  tier: Tier;
  reason: Reason;
  /** 1 is first; campaigns to wait with have no rank. */
  rank: number | null;
  /** Suggested daily budget, only for "now". */
  budgetCents: number | null;
  score: number;
  facts: CampaignFacts;
};

/** Performance Max steers itself by conversions; below this many in 30 days it buys cheap clicks. */
export const PMAX_MIN_CONVERSIONS = 30;
/** Below this a campaign gets too few clicks a day to learn from (about 0,30 € a click in Latvia). */
export const MIN_USEFUL_CENTS = 200;
export const BRAND_CENTS = 100;
/** At most this many category campaigns at once: concentration before coverage. */
export const MAX_NOW = 4;

/** Evidence first (what ad visitors did), then demand on the site, then whether Trilio sells it. */
export function score(f: CampaignFacts): number {
  return f.outcomes * 3 + f.adClicks * 0.5 + f.siteSearches * 0.2 + (f.sourced && f.siteSearches > 0 ? 5 : 0);
}

export function recommend(
  campaigns: CampaignFacts[],
  input: { dailyBudgetCents: number; conversions30d: number },
): Recommendation[] {
  const base = (f: CampaignFacts, tier: Tier, reason: Reason): Recommendation => ({
    id: f.id,
    name: f.name,
    tier,
    reason,
    rank: null,
    budgetCents: null,
    score: score(f),
    facts: f,
  });
  const brand = campaigns.filter((c) => c.kind === "search" && c.groupId === BRAND_GROUP);
  const rivals = campaigns.filter((c) => c.kind === "search" && c.groupId === COMPETITOR_GROUP);
  const pmax = campaigns.filter((c) => c.kind === "pmax");
  const categories = campaigns
    .filter((c) => c.kind === "search" && c.groupId !== BRAND_GROUP && c.groupId !== COMPETITOR_GROUP)
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));

  // How many category campaigns the budget can feed properly, after the brand campaign's share.
  const forCategories = Math.max(0, input.dailyBudgetCents - (brand.length ? BRAND_CENTS : 0));
  const affordable = Math.min(MAX_NOW, Math.floor(forCategories / MIN_USEFUL_CENTS));
  const withDemand = categories.filter((c) => score(c) > 0);
  const now = withDemand.slice(0, affordable);
  const total = now.reduce((n, c) => n + score(c), 0);

  const out: Recommendation[] = [];
  for (const c of brand) out.push({ ...base(c, "now", "brand"), budgetCents: BRAND_CENTS });
  let spent = 0;
  now.forEach((c, i) => {
    // Each gets the useful minimum, and the rest by its score.
    const spare = forCategories - MIN_USEFUL_CENTS * now.length;
    const share =
      i === now.length - 1
        ? forCategories - spent
        : MIN_USEFUL_CENTS + Math.floor((spare * score(c)) / (total || 1));
    spent += share;
    out.push({
      ...base(c, "now", c.outcomes > 0 ? "proven" : c.sourced ? "sourced_demand" : "demand"),
      budgetCents: share,
    });
  });
  for (const c of withDemand.slice(affordable))
    out.push(base(c, "next", affordable < MAX_NOW ? "no_budget" : c.sourced ? "sourced_demand" : "demand"));
  for (const c of rivals) out.push(base(c, "next", "competitor"));
  for (const c of categories.filter((c) => score(c) <= 0)) out.push(base(c, "wait", "low_demand"));
  for (const c of pmax)
    out.push(
      input.conversions30d >= PMAX_MIN_CONVERSIONS
        ? base(c, "next", "pmax_ready")
        : base(c, "wait", "pmax_needs_conversions"),
    );
  let rank = 0;
  return out.map((r) => (r.tier === "wait" ? r : { ...r, rank: ++rank }));
}
