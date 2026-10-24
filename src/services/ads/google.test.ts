import { describe, expect, it } from "vitest";
import { googleAdsConfigFromEnv, googleAdsProvider } from "./google";

// The Google Ads REST client against a recorded fake: the right headers,
// micros, paused campaigns with the EU political-ads declaration, and
// report rows mapped back (docs/GROWTH_PLAN.md §7).

function fake() {
  const calls: { url: string; init: RequestInit; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : String(init.body);
    calls.push({ url, init, body });
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (url.includes("oauth2")) return json({ access_token: "tok", expires_in: 3600 });
    if (url.endsWith("googleAds:search")) {
      const q = (body as { query: string }).query;
      if (q.includes("geo_target_constant"))
        return json({ results: [{ geoTargetConstant: { resourceName: "geoTargetConstants/2428" } }] });
      if (q.includes("language_constant"))
        return json({ results: [{ languageConstant: { resourceName: "languageConstants/1028" } }] });
      if (q.includes("FROM campaign"))
        return json({
          results: [
            {
              segments: { date: "2026-10-20" },
              campaign: { resourceName: "customers/1/campaigns/9" },
              metrics: { impressions: "100", clicks: "7", costMicros: "1230000", conversions: 1 },
            },
          ],
        });
      if (q.includes("search_term_view"))
        return json({
          results: [
            {
              segments: { date: "2026-10-20" },
              searchTermView: { searchTerm: "Ledusskapis Remonts" },
              adGroup: { resourceName: "customers/1/adGroups/3" },
              metrics: { clicks: "2", costMicros: "400000" },
            },
          ],
        });
      return json({ results: [] });
    }
    if (url.includes("campaignBudgets:mutate"))
      return json({ results: [{ resourceName: "customers/1/campaignBudgets/5" }] });
    if (url.includes("campaigns:mutate"))
      return json({ results: [{ resourceName: "customers/1/campaigns/9" }] });
    if (url.includes(":mutate")) return json({ results: [{ resourceName: "customers/1/x/1" }] });
    return new Response("nope", { status: 400 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const cfg = googleAdsConfigFromEnv({
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev",
  GOOGLE_ADS_CLIENT_ID: "id",
  GOOGLE_ADS_CLIENT_SECRET: "secret",
  GOOGLE_ADS_REFRESH_TOKEN: "refresh",
  GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: "111-222-3333",
})!;

describe("Google Ads client", () => {
  it("reads its configuration only when complete", () => {
    expect(cfg.customerId).toBe("1234567890");
    expect(cfg.loginCustomerId).toBe("1112223333");
    expect(googleAdsConfigFromEnv({})).toBeNull();
  });

  it("creates a paused Search campaign in Latvia, in Latvian, with its budget in micros", async () => {
    const { calls, fetchImpl } = fake();
    const p = googleAdsProvider(cfg, fetchImpl);
    const r = await p.apply({
      op: "create_campaign",
      name: "Search · Test",
      budgetCents: 1500,
      cpcCapCents: 30,
    });
    expect(r).toEqual({ ok: true, id: "customers/1/campaigns/9", budget: "customers/1/campaignBudgets/5" });
    const budget = calls.find((c) => c.url.includes("campaignBudgets:mutate"))!;
    expect(budget.init.headers).toMatchObject({
      authorization: "Bearer tok",
      "developer-token": "dev",
      "login-customer-id": "1112223333",
    });
    expect(JSON.stringify(budget.body)).toContain('"amountMicros":"15000000"');
    const campaign = calls.find((c) => c.url.endsWith("/campaigns:mutate"))!.body as {
      operations: { create: Record<string, unknown> }[];
    };
    expect(campaign.operations[0]!.create).toMatchObject({
      status: "PAUSED",
      advertisingChannelType: "SEARCH",
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    });
    const criteria = calls.find((c) => c.url.includes("campaignCriteria:mutate"))!;
    expect(JSON.stringify(criteria.body)).toContain("geoTargetConstants/2428");
    expect(JSON.stringify(criteria.body)).toContain("languageConstants/1028");
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
  });

  it("maps report rows back and turns API errors into a failed result", async () => {
    const { fetchImpl } = fake();
    const p = googleAdsProvider(cfg, fetchImpl);
    const rep = await p.report("2026-10-20", "2026-10-20", { campaigns: [], adGroups: [], keywords: [] });
    expect(rep.stats[0]).toEqual({
      level: "campaign",
      resource: "customers/1/campaigns/9",
      day: "2026-10-20",
      impressions: 100,
      clicks: 7,
      costMicros: 1_230_000,
      conversions: 1,
    });
    expect(rep.terms[0]).toMatchObject({
      term: "Ledusskapis Remonts",
      adGroup: "customers/1/adGroups/3",
      clicks: 2,
    });
    const failing = googleAdsProvider(
      cfg,
      (async () => new Response("denied", { status: 403 })) as unknown as typeof fetch,
    );
    const r = await failing.apply({ op: "set_cpc", adGroup: "customers/1/adGroups/3", cents: 40 });
    expect(r.ok).toBe(false);
  });
});
