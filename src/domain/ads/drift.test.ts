import { describe, expect, it } from "vitest";
import { accountDrift, fixable, issuesFor, type CampaignState, type Expected } from "./drift";

const e: Expected = {
  id: "c1",
  name: "Search · Ledusskapji",
  resource: "customers/1/campaigns/1",
  kind: "search",
  status: "paused",
  budget: "customers/1/campaignBudgets/1",
  budgetCents: 200,
  cpcCapCents: 30,
};
const g: CampaignState = {
  resource: e.resource,
  name: e.name,
  status: "paused",
  kind: "search",
  bidding: "maximize_clicks",
  portfolio: false,
  budget: e.budget!,
  budgetCents: 200,
  sharedBudget: false,
  cpcCapCents: 30,
};

describe("account drift", () => {
  it("finds nothing when Google has what Trilio set", () => {
    expect(issuesFor(e, g)).toEqual([]);
    expect(accountDrift([e], [g])).toEqual({ campaigns: [], foreign: [], matching: 1 });
  });

  it("names a campaign moved to a shared budget and conversion bidding", () => {
    const moved: CampaignState = {
      ...g,
      budget: "customers/1/campaignBudgets/9",
      budgetCents: 500,
      sharedBudget: true,
      bidding: "maximize_conversions",
      portfolio: true,
      cpcCapCents: null,
    };
    expect(issuesFor(e, moved)).toEqual([
      { kind: "shared_budget", googleCents: 500 },
      { kind: "bidding", google: "maximize_conversions", trilio: "maximize_clicks", portfolio: true },
    ]);
  });

  it("names status, budget amount and a lost price cap", () => {
    expect(issuesFor(e, { ...g, status: "enabled", budgetCents: 41, cpcCapCents: null })).toEqual([
      { kind: "status", google: "enabled", trilio: "paused" },
      { kind: "budget", googleCents: 41, trilioCents: 200 },
      { kind: "cpc_cap", googleCents: null, trilioCents: 30 },
    ]);
    // A lower cap than Trilio's is stricter, not a loss of control.
    expect(issuesFor(e, { ...g, cpcCapCents: 20 })).toEqual([]);
  });

  it("lists campaigns Trilio did not create, and leaves removed ones out", () => {
    const other = { ...g, resource: "customers/1/campaigns/7", name: "Zīmols — Trilio" };
    const gone = {
      ...g,
      resource: "customers/1/campaigns/8",
      name: "Campaign #1",
      status: "removed" as const,
    };
    const d = accountDrift([e], [g, other, gone]);
    expect(d.foreign.map((f) => f.name)).toEqual(["Zīmols — Trilio"]);
  });

  it("a campaign removed in Google is missing and cannot be put back", () => {
    expect(issuesFor(e, undefined)).toEqual([{ kind: "missing" }]);
    expect(fixable([{ kind: "missing" }], "search")).toBe(false);
  });

  it("Performance Max: conversions bidding is right; only status and amount are fixable", () => {
    const p: Expected = { ...e, kind: "pmax" };
    expect(issuesFor(p, { ...g, kind: "pmax", bidding: "maximize_conversions", cpcCapCents: null })).toEqual(
      [],
    );
    expect(fixable([{ kind: "budget", googleCents: 1, trilioCents: 2 }], "pmax")).toBe(true);
    expect(fixable([{ kind: "shared_budget", googleCents: 1 }], "pmax")).toBe(false);
  });
});
