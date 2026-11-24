import { describe, expect, it } from "vitest";
import {
  metaAdsConfigFromEnv,
  metaAdsFromEnv,
  metaAdsProvider,
  metaError,
  mockMetaAds,
  spendToCents,
} from "./meta-ads";

// Meta's Marketing API client: the requests it makes and how it reads the answers.

const cfg = { adAccountId: "1234567890", token: "token-x", version: "v23.0" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("configuration", () => {
  it("needs the ad account and the token; the account may carry its act_ prefix", () => {
    expect(metaAdsConfigFromEnv({})).toBeNull();
    expect(metaAdsConfigFromEnv({ META_AD_ACCOUNT_ID: "act_1234567890" })).toBeNull();
    expect(metaAdsConfigFromEnv({ META_AD_ACCOUNT_ID: "nope", META_SYSTEM_USER_TOKEN: "t" })).toBeNull();
    expect(
      metaAdsConfigFromEnv({ META_AD_ACCOUNT_ID: " act_1234567890 ", META_SYSTEM_USER_TOKEN: " t " }),
    ).toEqual({ adAccountId: "1234567890", token: "t", version: "v23.0" });
  });
  it("is off without the ads feature, a mock with the mock provider", () => {
    const env = { META_AD_ACCOUNT_ID: "1234567890", META_SYSTEM_USER_TOKEN: "t" };
    expect(metaAdsFromEnv(env)).toBeNull();
    expect(metaAdsFromEnv({ ...env, FEATURE_ADS: "1" })).not.toBeNull();
    expect(metaAdsFromEnv({ FEATURE_ADS: "1" })).toBeNull();
    expect(metaAdsFromEnv({ FEATURE_ADS: "1", ADS_PROVIDER: "mock" })).toHaveProperty("calls");
  });
});

describe("reading", () => {
  it("lists campaigns, ad sets and ads, following Meta's next page only", async () => {
    const seen: string[] = [];
    const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer token-x");
      if (url.includes("/campaigns?") && !url.includes("after=2"))
        return json({
          data: [
            {
              id: "111111",
              name: "Leads",
              status: "ACTIVE",
              effective_status: "ACTIVE",
              daily_budget: "500",
            },
          ],
          paging: { next: "https://graph.facebook.com/v23.0/act_1234567890/campaigns?after=2" },
        });
      if (url.includes("/campaigns?"))
        return json({
          data: [{ id: "111112", name: "Old", status: "PAUSED", effective_status: "PAUSED" }],
          paging: { next: "https://evil.example/steal" },
        });
      if (url.includes("/adsets?"))
        return json({
          data: [
            { id: "222221", name: "LV", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "111111" },
          ],
        });
      return json({
        data: [
          {
            id: "333331",
            name: "A1",
            status: "ACTIVE",
            effective_status: "ADSET_PAUSED",
            adset_id: "222221",
            campaign_id: "111111",
          },
        ],
      });
    }) as typeof fetch;
    const r = await metaAdsProvider(cfg, http).list();
    if (!r.ok) throw new Error(r.error);
    expect(r.entities).toEqual([
      {
        id: "111111",
        level: "campaign",
        name: "Leads",
        campaignId: null,
        adsetId: null,
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
        dailyBudgetCents: 500,
      },
      {
        id: "111112",
        level: "campaign",
        name: "Old",
        campaignId: null,
        adsetId: null,
        status: "PAUSED",
        effectiveStatus: "PAUSED",
        dailyBudgetCents: null,
      },
      {
        id: "222221",
        level: "adset",
        name: "LV",
        campaignId: "111111",
        adsetId: null,
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
        dailyBudgetCents: null,
      },
      {
        id: "333331",
        level: "ad",
        name: "A1",
        campaignId: "111111",
        adsetId: "222221",
        status: "ACTIVE",
        effectiveStatus: "ADSET_PAUSED",
        dailyBudgetCents: null,
      },
    ]);
    expect(seen.some((u) => u.startsWith("https://evil.example"))).toBe(false);
    expect(seen[0]).toContain("https://graph.facebook.com/v23.0/act_1234567890/");
  });

  it("reads the daily numbers per ad: spend in euro becomes cents", async () => {
    let asked = "";
    const http = (async (input: RequestInfo | URL) => {
      asked = decodeURIComponent(String(input));
      return json({
        data: [
          {
            ad_id: "333331",
            campaign_id: "111111",
            spend: "1.07",
            impressions: "210",
            inline_link_clicks: "4",
            date_start: "2026-11-20",
          },
          { ad_id: "333331", campaign_id: "111111", spend: "0", date_start: "2026-11-21" },
          { ad_id: "", campaign_id: "111111", spend: "3", date_start: "2026-11-21" },
        ],
      });
    }) as typeof fetch;
    const r = await metaAdsProvider(cfg, http).insights("2026-11-20", "2026-11-21");
    if (!r.ok) throw new Error(r.error);
    expect(r.rows).toEqual([
      {
        day: "2026-11-20",
        adId: "333331",
        campaignId: "111111",
        spendCents: 107,
        impressions: 210,
        linkClicks: 4,
      },
      {
        day: "2026-11-21",
        adId: "333331",
        campaignId: "111111",
        spendCents: 0,
        impressions: 0,
        linkClicks: 0,
      },
    ]);
    expect(asked).toContain("level=ad");
    expect(asked).toContain("time_increment=1");
    expect(asked).toContain('time_range={"since":"2026-11-20","until":"2026-11-21"}');
    expect(spendToCents("12.345")).toBe(1235);
    expect(spendToCents(undefined)).toBe(0);
  });

  it("gives Meta's error as text, and a network failure too", async () => {
    const denied = (async () =>
      json(
        { error: { message: "Permissions error", code: 200, error_user_msg: "Nav piekļuves" } },
        403,
      )) as typeof fetch;
    expect(await metaAdsProvider(cfg, denied).list()).toEqual({
      ok: false,
      error: "Permissions error (Nav piekļuves) [200]",
    });
    const down = (async () => {
      throw new Error("reset");
    }) as typeof fetch;
    expect(await metaAdsProvider(cfg, down).insights("2026-11-20", "2026-11-21")).toEqual({
      ok: false,
      error: "Meta: reset",
    });
    expect(metaError(null, 500)).toBe("Meta HTTP 500");
    expect(
      metaError({ error: { message: "Too many calls", code: 80004, error_subcode: 2446079 } }, 400),
    ).toBe("Too many calls [80004/2446079]");
  });
});

describe("changing", () => {
  it("sets a daily budget in cents and a status, by a form post to the id", async () => {
    const sent: { url: string; body: string; method?: string }[] = [];
    const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), body: String(init?.body), method: init?.method });
      return json({ success: true });
    }) as typeof fetch;
    const meta = metaAdsProvider(cfg, http);
    expect(await meta.setDailyBudget("111111", 250)).toEqual({ ok: true });
    expect(await meta.setStatus("333331", "PAUSED")).toEqual({ ok: true });
    expect(sent).toEqual([
      { url: "https://graph.facebook.com/v23.0/111111", body: "daily_budget=250", method: "POST" },
      { url: "https://graph.facebook.com/v23.0/333331", body: "status=PAUSED", method: "POST" },
    ]);
    expect(await meta.setStatus("../me", "PAUSED")).toEqual({ ok: false, error: "not a Meta id" });
  });
  it("reports a refusal", async () => {
    const http = (async () => json({ error: { message: "Budget too low", code: 100 } }, 400)) as typeof fetch;
    expect(await metaAdsProvider(cfg, http).setDailyBudget("111111", 10)).toEqual({
      ok: false,
      error: "Budget too low [100]",
    });
    const broken = (async () => {
      throw new Error("timeout");
    }) as typeof fetch;
    expect(await metaAdsProvider(cfg, broken).setStatus("111111", "ACTIVE")).toEqual({
      ok: false,
      error: "Meta: timeout",
    });
  });
});

describe("the mock account", () => {
  it("remembers what was changed", async () => {
    const meta = mockMetaAds();
    expect(await meta.setDailyBudget("9100000001", 200)).toEqual({ ok: true });
    expect(await meta.setStatus("9300000002", "PAUSED")).toEqual({ ok: true });
    expect(await meta.setStatus("nope", "PAUSED")).toEqual({ ok: false, error: "unknown id" });
    expect(await meta.setDailyBudget("nope", 1)).toEqual({ ok: false, error: "unknown id" });
    const r = await meta.list();
    if (!r.ok) throw new Error("list");
    expect(r.entities.find((e) => e.id === "9100000001")!.dailyBudgetCents).toBe(200);
    expect(r.entities.find((e) => e.id === "9300000002")!.effectiveStatus).toBe("PAUSED");
    expect(meta.calls).toHaveLength(2);
    expect(await meta.insights("2026-01-01", "2026-01-02")).toEqual({ ok: true, rows: [] });
  });
});

describe("creating", () => {
  it("makes a campaign for e-mails, an ad set for Latvia and a link ad, each as a form post to the account", async () => {
    const sent: { url: string; fields: Record<string, string> }[] = [];
    const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      sent.push({ url, fields: Object.fromEntries(new URLSearchParams(String(init?.body))) });
      if (url.endsWith("/adimages")) return json({ images: { bytes: { hash: "abc123", url: "https://x" } } });
      return json({ id: String(700000 + sent.length), success: true });
    }) as typeof fetch;
    const meta = metaAdsProvider(cfg, http);

    expect(await meta.uploadImage(Buffer.from("jpeg"))).toEqual({ ok: true, id: "abc123" });
    expect(sent[0]!.url).toBe("https://graph.facebook.com/v23.0/act_1234567890/adimages");
    expect(sent[0]!.fields.bytes).toBe(Buffer.from("jpeg").toString("base64"));

    expect(await meta.createCampaign({ name: "trilio-ai-epasti", dailyBudgetCents: 250 })).toEqual({
      ok: true,
      id: "700002",
    });
    expect(sent[1]!.url).toBe("https://graph.facebook.com/v23.0/act_1234567890/campaigns");
    expect(sent[1]!.fields).toEqual({
      name: "trilio-ai-epasti",
      objective: "OUTCOME_LEADS",
      status: "ACTIVE",
      special_ad_categories: "[]",
      buying_type: "AUCTION",
      daily_budget: "250",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    });

    await meta.createAdSet({
      campaignId: "700002",
      name: "latvija",
      pixelId: "2161476984461393",
      advertiser: "Sky Solutions SIA",
    });
    expect(sent[2]!.url).toBe("https://graph.facebook.com/v23.0/act_1234567890/adsets");
    expect(sent[2]!.fields).toMatchObject({
      campaign_id: "700002",
      billing_event: "IMPRESSIONS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      destination_type: "WEBSITE",
      dsa_beneficiary: "Sky Solutions SIA",
      dsa_payor: "Sky Solutions SIA",
    });
    expect(JSON.parse(sent[2]!.fields.promoted_object!)).toEqual({
      pixel_id: "2161476984461393",
      custom_event_type: "LEAD",
    });
    expect(JSON.parse(sent[2]!.fields.targeting!)).toEqual({
      geo_locations: { countries: ["LV"] },
      targeting_automation: { advantage_audience: 1 },
    });

    const link = "https://trilio.lv/rezultati?sub=fridge&utm_source=meta";
    await meta.createAd({
      adsetId: "700003",
      name: "fridge-20261124",
      pageId: "100200300",
      instagramUserId: "17840000000000000",
      link,
      message: "Ledusskapji: 3 piemēroti varianti šodienas cenās.",
      headline: "Ledusskapji: 3 piemēroti varianti",
      description: "Cenas partneru veikalos",
      imageHash: "abc123",
      domain: "trilio.lv",
    });
    expect(sent[3]!.url).toBe("https://graph.facebook.com/v23.0/act_1234567890/ads");
    expect(sent[3]!.fields).toMatchObject({
      name: "fridge-20261124",
      adset_id: "700003",
      status: "ACTIVE",
      conversion_domain: "trilio.lv",
    });
    expect(JSON.parse(sent[3]!.fields.creative!)).toEqual({
      name: "fridge-20261124",
      object_story_spec: {
        page_id: "100200300",
        instagram_user_id: "17840000000000000",
        link_data: {
          link,
          message: "Ledusskapji: 3 piemēroti varianti šodienas cenās.",
          name: "Ledusskapji: 3 piemēroti varianti",
          description: "Cenas partneru veikalos",
          image_hash: "abc123",
          call_to_action: { type: "LEARN_MORE", value: { link } },
        },
      },
    });
  });

  it("reports a refusal, a missing id, a missing image hash and a network failure", async () => {
    const refuse = (async () =>
      json({ error: { message: "Invalid parameter", code: 100 } }, 400)) as typeof fetch;
    expect(await metaAdsProvider(cfg, refuse).createCampaign({ name: "x", dailyBudgetCents: 1 })).toEqual({
      ok: false,
      error: "Invalid parameter [100]",
    });
    const empty = (async () => json({})) as typeof fetch;
    expect((await metaAdsProvider(cfg, empty).createCampaign({ name: "x", dailyBudgetCents: 1 })).ok).toBe(
      false,
    );
    expect(await metaAdsProvider(cfg, empty).uploadImage(Buffer.from("x"))).toEqual({
      ok: false,
      error: "Meta returned no image hash",
    });
    const down = (async () => {
      throw new Error("reset");
    }) as typeof fetch;
    expect(await metaAdsProvider(cfg, down).uploadImage(Buffer.from("x"))).toEqual({
      ok: false,
      error: "Meta: reset",
    });
  });

  it("the mock account makes what is asked and refuses an ad without its ad set", async () => {
    const meta = mockMetaAds({ entities: [] });
    const c = await meta.createCampaign({ name: "c", dailyBudgetCents: 200 });
    if (!c.ok) throw new Error("campaign");
    const s = await meta.createAdSet({ campaignId: c.id, name: "s", pixelId: "1", advertiser: "a" });
    if (!s.ok) throw new Error("ad set");
    const base = {
      name: "a",
      pageId: "1",
      link: "l",
      message: "m",
      headline: "h",
      description: "d",
      imageHash: "i",
      domain: "x",
    };
    expect((await meta.createAd({ ...base, adsetId: s.id })).ok).toBe(true);
    expect(await meta.createAd({ ...base, adsetId: "nope" })).toEqual({ ok: false, error: "unknown ad set" });
    expect(await meta.uploadImage(Buffer.alloc(0))).toEqual({ ok: false, error: "empty image" });
    const listed = await meta.list();
    expect(listed.ok && listed.entities.map((e) => e.level)).toEqual(["campaign", "adset", "ad"]);
  });
});
