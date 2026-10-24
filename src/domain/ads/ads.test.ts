import { describe, expect, it } from "vitest";
import seed from "../../../data/keywords.lv.json";
import { catalog } from "@/domain/questions/catalog";
import { costPerConversion, pacedBudget, splitBudget, weightedConversions } from "./budget";
import { checkProposal, MAX_CHANGES_PER_DAY, type AccountState } from "./guardrails";
import { lintAd, lintAdText } from "./honesty";
import { buildCampaignPlan, templateAd } from "./plan";

describe("honesty lint", () => {
  it("blocks urgency, discounts, guarantees, superlatives, shouting and numbers not in the data", () => {
    expect(lintAdText("Tikai šodien!", "headline")).toContain("fake urgency");
    expect(lintAdText("Lielas atlaides ledusskapjiem", "headline")).toContain(
      "discount claim Trilio does not make",
    );
    expect(lintAdText("Garantēti labākā cena", "headline")).toContain("guarantee claim");
    expect(lintAdText("Lētākais Latvijā", "headline")).toContain("cheapest-anywhere claim");
    expect(lintAdText("LEDUSSKAPJI LĒTI", "headline")).toContain("shouting");
    expect(lintAdText("Ledusskapji no 199 €", "headline")).toContain("number 199 is not in the data");
    expect(lintAdText("Ledusskapji no 199 €", "headline", { allowedNumbers: [199] })).toEqual([]);
    expect(lintAdText("x".repeat(31), "headline")).toContain("longer than 30 characters");
    expect(lintAdText("Labāk nekā kurpirkt.lv", "headline")).toContain("competitor name");
    expect(lintAdText("Alternatīva salidzini.lv", "headline")).toContain("competitor name");
    expect(lintAdText("Salīdzini cenas veikalos", "headline")).toEqual([]);
  });
  it("checks a whole ad", () => {
    expect(lintAd(templateAd("Ledusskapji"))).toEqual([]);
    expect(lintAd({ headlines: ["A", "A", "B"], descriptions: ["x", "y"] })).toContain("duplicate headline");
    expect(lintAd({ headlines: ["A"], descriptions: ["x"] })).toEqual(
      expect.arrayContaining(["needs 3–15 headlines", "needs 2–4 descriptions"]),
    );
  });
});

describe("campaign plan", () => {
  const plan = buildCampaignPlan(catalog, seed, 1500);
  it("makes one campaign per group, one ad group per subcategory, with honest template ads", () => {
    expect(plan.length).toBe(10);
    const groups = plan.flatMap((c) => c.adGroups);
    expect(groups.length).toBe(40);
    for (const g of groups) {
      expect(g.landingPath).toMatch(/^\/izvelies(\/[a-z]+\/[a-z]+)?$/);
      expect(g.keywords.length).toBeGreaterThan(0);
      expect(lintAd(g.ad), g.subcategoryId).toEqual([]);
    }
    expect(plan.reduce((a, c) => a + c.budgetCents, 0)).toBe(1500);
    expect(plan.every((c) => c.budgetCents >= 100)).toBe(true);
  });
  it("bids on the comparison sites' names, which never appear in the ad", () => {
    const rivals = plan.find((c) => c.groupId === "competitors")!;
    const g = rivals.adGroups[0]!;
    expect(g.keywords).toEqual(expect.arrayContaining(["kurpirkt.lv", "salidzini.lv"]));
    expect(g.landingPath).toBe("/izvelies");
    expect([...g.ad.headlines, ...g.ad.descriptions].join(" ")).not.toMatch(/kurpirkt|salidzini/i);
    expect(lintAd(g.ad)).toEqual([]);
  });
});

describe("budget", () => {
  it("splits exactly, with a floor per campaign", () => {
    const s = splitBudget(1000, { a: 10, b: 0, c: 30 });
    expect(s.a! + s.b! + s.c!).toBe(1000);
    expect(s.b).toBe(100);
    expect(s.c).toBeGreaterThan(s.a!);
    expect(splitBudget(150, { a: 1, b: 1, c: 1 })).toEqual({ a: 50, b: 50, c: 50 });
  });
  const settings = {
    dailyBudgetCents: 1500,
    floorCents: 500,
    targetCostCents: 100,
    clickWeight: 1,
    saveWeight: 3,
  };
  it("counts weighted conversions and their cost", () => {
    const p = { cost7dCents: 6000, shopClicks7d: 30, saves7d: 10 };
    expect(weightedConversions(p, settings)).toBe(60);
    expect(costPerConversion(p, settings)).toBe(100);
  });
  it("cuts 20 % a day while the target is missed, never below the floor or above the owner's number", () => {
    const bad = { cost7dCents: 9000, shopClicks7d: 10, saves7d: 0 };
    expect(pacedBudget(1500, bad, settings).cents).toBe(1200);
    expect(pacedBudget(550, bad, settings).cents).toBe(500);
    const good = { cost7dCents: 3000, shopClicks7d: 60, saves7d: 0 };
    expect(pacedBudget(1000, good, settings).cents).toBe(1200);
    expect(pacedBudget(1400, good, settings).cents).toBe(1500);
    expect(pacedBudget(800, good, { ...settings, targetCostCents: null }).cents).toBe(1500);
    expect(pacedBudget(800, { cost7dCents: 100, shopClicks7d: 0, saves7d: 0 }, settings).why).toBe(
      "too little data",
    );
  });
});

describe("guardrails", () => {
  const state: AccountState = {
    paused: false,
    campaigns: new Map([
      ["c1", { budgetCents: 1000, status: "enabled" }],
      ["c2", { budgetCents: 110, status: "enabled" }],
    ]),
    adGroups: new Map([["g1", { campaignId: "c1", cpcCapCents: 30 }]]),
    keywords: new Map([
      ["k1", { adGroupId: "g1", campaignId: "c1", text: "ledusskapis", negative: false, status: "enabled" }],
      [
        "k2",
        { adGroupId: "g1", campaignId: "c1", text: "kluss ledusskapis", negative: false, status: "enabled" },
      ],
    ]),
    convertingTerms: ["ledusskapis bosch", "kluss ledusskapis"],
    appliedToday: 0,
  };
  const ok = (p: unknown) => checkProposal(p, state).ok;
  const why = (p: unknown) => (checkProposal(p, state) as { reason?: string }).reason;

  it("lets bounded changes through", () => {
    expect(ok({ action: "add_negative", campaignId: "c1", text: "remonts", match: "phrase" })).toBe(true);
    expect(ok({ action: "pause_keyword", keywordId: "k1" })).toBe(true);
    expect(ok({ action: "add_keyword", adGroupId: "g1", text: "ledusskapis 60 cm", match: "phrase" })).toBe(
      true,
    );
    expect(ok({ action: "set_cpc", adGroupId: "g1", cpcCapCents: 40 })).toBe(true);
    expect(ok({ action: "move_budget", fromCampaignId: "c1", toCampaignId: "c2", cents: 200 })).toBe(true);
    expect(ok({ action: "new_ad", adGroupId: "g1", ...templateAd("Ledusskapji") })).toBe(true);
  });
  it("blocks what could hurt or mislead", () => {
    expect(why({ action: "add_negative", campaignId: "c1", text: "bosch", match: "phrase" })).toMatch(
      /converting/,
    );
    expect(why({ action: "pause_keyword", keywordId: "k2" })).toMatch(/conversions/);
    expect(why({ action: "add_negative", campaignId: "c1", text: "kluss", match: "phrase" })).toMatch(/own keyword/);
    expect(why({ action: "add_keyword", adGroupId: "g1", text: "fridge <b>", match: "phrase" })).toMatch(
      /invalid/,
    );
    expect(why({ action: "set_cpc", adGroupId: "g1", cpcCapCents: 500 })).toMatch(/outside/);
    expect(why({ action: "set_cpc", adGroupId: "g1", cpcCapCents: 60 })).toMatch(/more than half/);
    expect(why({ action: "move_budget", fromCampaignId: "c1", toCampaignId: "c2", cents: 300 })).toMatch(
      /20 %/,
    );
    expect(why({ action: "move_budget", fromCampaignId: "c2", toCampaignId: "c1", cents: 20 })).toMatch(
      /1 €/,
    );
    expect(
      why({
        action: "new_ad",
        adGroupId: "g1",
        headlines: ["Tikai šodien", "A", "B"],
        descriptions: ["x", "y"],
      }),
    ).toMatch(/urgency/);
    expect(why({ action: "set_status", campaignId: "c1" })).toMatch(/invalid/);
    expect(why({ action: "add_keyword", adGroupId: "nope", text: "x y", match: "exact" })).toMatch(/unknown/);
  });
  it("stops everything when paused or at the daily limit", () => {
    const p = { action: "pause_keyword", keywordId: "k1" };
    expect(checkProposal(p, { ...state, paused: true }).ok).toBe(false);
    expect(checkProposal(p, { ...state, appliedToday: MAX_CHANGES_PER_DAY }).ok).toBe(false);
  });
});
