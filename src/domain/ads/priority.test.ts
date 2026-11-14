import { describe, expect, it } from "vitest";
import { recommend, type CampaignFacts } from "./priority";

const c = (name: string, over: Partial<CampaignFacts> = {}): CampaignFacts => ({
  id: name,
  name,
  kind: "search",
  groupId: name,
  status: "paused",
  adClicks: 0,
  costCents: 0,
  outcomes: 0,
  siteSearches: 0,
  sourced: false,
  ...over,
});

describe("campaign priorities", () => {
  const campaigns = [
    c("cool", { siteSearches: 110, sourced: true }),
    c("laundry", { siteSearches: 130, adClicks: 2 }),
    c("kitchenbig", { siteSearches: 55, adClicks: 9, outcomes: 3 }),
    c("coffee", { siteSearches: 34 }),
    c("clean", { siteSearches: 25 }),
    c("personal"),
    c("brand", { groupId: "brand" }),
    c("competitors", { groupId: "competitors" }),
    c("pmax", { kind: "pmax", groupId: "cool" }),
  ];

  it("puts the brand first, then the categories with evidence and demand, within the budget", () => {
    const r = recommend(campaigns, { dailyBudgetCents: 1200, conversions30d: 2 });
    const now = r.filter((x) => x.tier === "now");
    expect(now.map((x) => x.name)).toEqual(["brand", "cool", "laundry", "kitchenbig", "coffee"]);
    expect(now.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(now[0]).toMatchObject({ reason: "brand", budgetCents: 100 });
    expect(r.find((x) => x.name === "kitchenbig")!.reason).toBe("proven");
    expect(r.find((x) => x.name === "cool")!.reason).toBe("sourced_demand");
    // The whole budget is handed out, each campaign at least the useful minimum.
    expect(now.reduce((n, x) => n + x.budgetCents!, 0)).toBe(1200);
    expect(now.slice(1).every((x) => x.budgetCents! >= 200)).toBe(true);
    expect(r.find((x) => x.name === "clean")).toMatchObject({ tier: "next", reason: "demand" });
    expect(r.find((x) => x.name === "competitors")).toMatchObject({ tier: "next", reason: "competitor" });
    expect(r.find((x) => x.name === "personal")).toMatchObject({
      tier: "wait",
      reason: "low_demand",
      rank: null,
    });
  });

  it("keeps Performance Max waiting until there are conversions to steer by", () => {
    const few = recommend(campaigns, { dailyBudgetCents: 1200, conversions30d: 2 });
    expect(few.find((x) => x.name === "pmax")).toMatchObject({
      tier: "wait",
      reason: "pmax_needs_conversions",
    });
    const enough = recommend(campaigns, { dailyBudgetCents: 1200, conversions30d: 30 });
    expect(enough.find((x) => x.name === "pmax")).toMatchObject({ tier: "next", reason: "pmax_ready" });
  });

  it("switches on fewer campaigns when the budget cannot feed them", () => {
    const r = recommend(campaigns, { dailyBudgetCents: 500, conversions30d: 0 });
    const now = r.filter((x) => x.tier === "now");
    expect(now.map((x) => x.name)).toEqual(["brand", "cool", "laundry"]);
    expect(now.map((x) => x.budgetCents)).toEqual([100, 200, 200]);
    expect(r.find((x) => x.name === "kitchenbig")).toMatchObject({ tier: "next", reason: "no_budget" });
  });
});
