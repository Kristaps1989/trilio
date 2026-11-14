// Is the ads account what Trilio set? (docs/GROWTH_PLAN.md, "Account control".)
// Trilio writes settings to Google Ads, but anyone with access to the account,
// and Google's own auto-applied recommendations, can change them afterwards.
// This compares what Trilio expects with what Google reports. Pure: no I/O.

export type Bidding =
  | "maximize_clicks"
  | "maximize_conversions"
  | "maximize_conversion_value"
  | "target_impression_share"
  | "manual_cpc"
  | "other";

/** One campaign as the ads platform reports it. */
export type CampaignState = {
  resource: string;
  name: string;
  status: "enabled" | "paused" | "removed";
  kind: "search" | "pmax" | "other";
  bidding: Bidding;
  /** The bidding strategy is a shared (portfolio) one, set outside the campaign. */
  portfolio: boolean;
  budget: string;
  budgetCents: number;
  /** The budget is shared with other campaigns, so it is not this campaign's own. */
  sharedBudget: boolean;
  /** Maximise clicks only: the most one click may cost. Null: no cap. */
  cpcCapCents: number | null;
};

/** One campaign as Trilio set it. */
export type Expected = {
  id: string;
  name: string;
  resource: string;
  kind: "search" | "pmax";
  status: "enabled" | "paused";
  budget: string | null;
  budgetCents: number;
  cpcCapCents: number;
};

export type Issue =
  | { kind: "missing" }
  | { kind: "status"; google: "enabled" | "paused"; trilio: "enabled" | "paused" }
  | { kind: "budget"; googleCents: number; trilioCents: number }
  | { kind: "shared_budget"; googleCents: number }
  | { kind: "bidding"; google: Bidding; trilio: Bidding; portfolio: boolean }
  | { kind: "cpc_cap"; googleCents: number | null; trilioCents: number };

export type Drift = {
  /** Trilio's campaigns whose settings in Google differ. */
  campaigns: { id: string; name: string; resource: string; kind: "search" | "pmax"; issues: Issue[] }[];
  /** Campaigns in the account that Trilio did not create and does not manage. */
  foreign: CampaignState[];
  /** Trilio's campaigns that match. */
  matching: number;
};

/** What Trilio sets: Search buys clicks under a price cap, Performance Max buys conversions. */
export function expectedBidding(kind: "search" | "pmax"): Bidding {
  return kind === "search" ? "maximize_clicks" : "maximize_conversions";
}

export function issuesFor(e: Expected, g: CampaignState | undefined): Issue[] {
  if (!g || g.status === "removed") return [{ kind: "missing" }];
  const issues: Issue[] = [];
  if (g.status !== e.status) issues.push({ kind: "status", google: g.status, trilio: e.status });
  const own = !g.sharedBudget && (e.budget === null || g.budget === e.budget);
  if (!own) issues.push({ kind: "shared_budget", googleCents: g.budgetCents });
  else if (g.budgetCents !== e.budgetCents)
    issues.push({ kind: "budget", googleCents: g.budgetCents, trilioCents: e.budgetCents });
  const want = expectedBidding(e.kind);
  if (g.bidding !== want || g.portfolio)
    issues.push({ kind: "bidding", google: g.bidding, trilio: want, portfolio: g.portfolio });
  else if (e.kind === "search" && (g.cpcCapCents === null || g.cpcCapCents > e.cpcCapCents))
    issues.push({ kind: "cpc_cap", googleCents: g.cpcCapCents, trilioCents: e.cpcCapCents });
  return issues;
}

export function accountDrift(expected: Expected[], google: CampaignState[]): Drift {
  const byResource = new Map(google.map((g) => [g.resource, g]));
  const mine = new Set(expected.map((e) => e.resource));
  const campaigns: Drift["campaigns"] = [];
  let matching = 0;
  for (const e of expected) {
    const issues = issuesFor(e, byResource.get(e.resource));
    if (issues.length === 0) matching++;
    else campaigns.push({ id: e.id, name: e.name, resource: e.resource, kind: e.kind, issues });
  }
  return {
    campaigns,
    foreign: google.filter((g) => !mine.has(g.resource) && g.status !== "removed"),
    matching,
  };
}

/** Whether Trilio can put the campaign back itself (a removed campaign it cannot). */
export function fixable(issues: Issue[], kind: "search" | "pmax"): boolean {
  if (issues.some((i) => i.kind === "missing")) return false;
  // Performance Max bidding and budgets are set when it is created; Trilio only changes amount and status.
  if (kind === "pmax") return issues.every((i) => i.kind === "status" || i.kind === "budget");
  return true;
}
