import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { googleSearchConsole } from "@/services/seo/search-console";
import {
  ADWORDS_SCOPE,
  explainAdsError,
  googleAdsConfigFromEnv,
  googleAdsProvider,
  serviceAccountFromEnv,
} from "./google";

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

  it("signs in as the Cloud project's service account, with no developer token", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = {
      type: "service_account",
      client_email: "trilio-ads@trilio.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
    const json = JSON.stringify(key);
    expect(serviceAccountFromEnv(Buffer.from(json).toString("base64"))?.client_email).toBe(key.client_email);
    expect(serviceAccountFromEnv("{not json")).toBeNull();
    expect(serviceAccountFromEnv(JSON.stringify({ client_email: "x" }))).toBeNull();

    const sa = googleAdsConfigFromEnv({
      GOOGLE_SERVICE_ACCOUNT_KEY: json,
      GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
    })!;
    expect(sa.credentials.kind).toBe("service_account");
    expect(sa.version).toBe("v26");
    expect(sa.developerToken).toBeUndefined();

    const { calls, fetchImpl } = fake();
    await googleAdsProvider(sa, fetchImpl).apply({
      op: "set_cpc",
      adGroup: "customers/1/adGroups/3",
      cents: 40,
    });
    const signIn = calls.find((c) => c.url.includes("oauth2"))!;
    const form = new URLSearchParams(signIn.body as string);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [head, claims, sig] = form.get("assertion")!.split(".") as [string, string, string];
    expect(
      createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(publicKey, Buffer.from(sig, "base64url")),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      iss: key.client_email,
      scope: ADWORDS_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
    });
    const mutate = calls.find((c) => c.url.includes("adGroups:mutate"))!;
    expect(mutate.init.headers).not.toHaveProperty("developer-token");
    expect(mutate.init.headers).not.toHaveProperty("login-customer-id");

    // Search Console reads with the same service account, its own scope.
    const sc = fake();
    const scFetch = (async (url: string, init: RequestInit) =>
      url.includes("searchAnalytics")
        ? new Response(
            JSON.stringify({
              rows: [
                {
                  keys: ["2026-10-20", "ledusskapis", "https://trilio.lv/kategorija/fridge"],
                  clicks: 1,
                  impressions: 9,
                  position: 7.5,
                },
              ],
            }),
          )
        : sc.fetchImpl(url, init)) as unknown as typeof fetch;
    const rows = await googleSearchConsole("sc-domain:trilio.lv", sa.credentials, scFetch).rows(
      "2026-10-20",
      "2026-10-20",
    );
    expect(rows).toEqual([
      {
        day: "2026-10-20",
        query: "ledusskapis",
        page: "/kategorija/fridge",
        clicks: 1,
        impressions: 9,
        position: 7.5,
      },
    ]);
    const scClaims = new URLSearchParams(sc.calls[0]!.body as string).get("assertion")!.split(".")[1]!;
    expect(JSON.parse(Buffer.from(scClaims, "base64url").toString()).scope).toContain("webmasters.readonly");
  });

  it("explains the refusals the owner can fix in the Google consoles", async () => {
    expect(explainAdsError(403, '{"errorCode":"CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION"}')).toMatch(
      /Explorer/,
    );
    expect(explainAdsError(403, "USER_PERMISSION_DENIED")).toMatch(/Access and security/);
    expect(explainAdsError(500, "boom")).toBe("google ads 500: boom");
    const refused = googleAdsProvider(cfg, (async (url: string) =>
      url.includes("oauth2")
        ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }))
        : new Response(
            '{"error":{"details":[{"errors":[{"errorCode":{"authorizationError":"CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION"}}]}]}}',
            {
              status: 403,
            },
          )) as unknown as typeof fetch);
    const r = await refused.apply({ op: "set_cpc", adGroup: "customers/1/adGroups/3", cents: 40 });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Explorer/) });
  });
});
