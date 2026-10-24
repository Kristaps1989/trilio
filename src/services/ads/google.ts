import type { AdsChange, AdsProvider, ApplyResult, StatRow, TermRow } from "./provider";

// Google Ads API over REST (docs/GROWTH_PLAN.md §7): OAuth refresh token for
// the company account, the developer token, and the manager (login) account.
// New campaigns are created PAUSED; the owner switches them on in the admin.
// Money: Google counts micros (1 € = 1 000 000), Trilio cents.

export type GoogleAdsConfig = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The account the ads run in, digits only. */
  customerId: string;
  /** The manager account, digits only; optional when the account is accessed directly. */
  loginCustomerId?: string;
  /** API version path segment, e.g. "v25". */
  version: string;
  siteUrl: string;
};

export function googleAdsConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GoogleAdsConfig | null {
  const digits = (v?: string) => v?.replace(/\D/g, "") || undefined;
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_ADS_REFRESH_TOKEN;
  const customerId = digits(env.GOOGLE_ADS_CUSTOMER_ID);
  if (!developerToken || !clientId || !clientSecret || !refreshToken || !customerId) return null;
  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    customerId,
    loginCustomerId: digits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
    version: env.GOOGLE_ADS_API_VERSION || "v25",
    siteUrl: (env.APP_URL || "https://trilio.lv").replace(/\/$/, ""),
  };
}

type Fetch = typeof fetch;

/** An OAuth access token from the refresh token, cached until a minute before it expires. */
export function googleTokenSource(
  cfg: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: Fetch = fetch,
) {
  let cached: { token: string; until: number } | null = null;
  return async (): Promise<string> => {
    if (cached && cached.until > Date.now()) return cached.token;
    const res = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`oauth ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, until: Date.now() + (body.expires_in - 60) * 1000 };
    return body.access_token;
  };
}

const micros = (cents: number) => String(cents * 10_000);
const MATCH = { exact: "EXACT", phrase: "PHRASE", broad: "BROAD" } as const;
const STATUS = { enabled: "ENABLED", paused: "PAUSED" } as const;

type Row = Record<string, Record<string, unknown> | undefined>;

export function googleAdsProvider(cfg: GoogleAdsConfig, fetchImpl: Fetch = fetch): AdsProvider {
  const token = googleTokenSource(cfg, fetchImpl);
  const base = `https://googleads.googleapis.com/${cfg.version}/customers/${cfg.customerId}`;

  async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetchImpl(`${base}/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await token()}`,
        "developer-token": cfg.developerToken,
        ...(cfg.loginCustomerId ? { "login-customer-id": cfg.loginCustomerId } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`google ads ${res.status}: ${text.slice(0, 500)}`);
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  async function search(query: string): Promise<Row[]> {
    const out: Row[] = [];
    let pageToken: string | undefined;
    do {
      const page = await call("googleAds:search", { query, ...(pageToken ? { pageToken } : {}) });
      out.push(...((page.results as Row[] | undefined) ?? []));
      pageToken = page.nextPageToken as string | undefined;
    } while (pageToken);
    return out;
  }

  async function mutate(service: string, operations: unknown[]): Promise<string> {
    const res = await call(`${service}:mutate`, { operations });
    const first = (res.results as { resourceName?: string }[] | undefined)?.[0];
    return first?.resourceName ?? "";
  }

  let targeting: { geo: string; language: string } | null = null;
  async function latvia(): Promise<{ geo: string; language: string }> {
    if (targeting) return targeting;
    const [geo] = await search(
      "SELECT geo_target_constant.resource_name FROM geo_target_constant WHERE geo_target_constant.country_code = 'LV' AND geo_target_constant.target_type = 'Country'",
    );
    const [lang] = await search(
      "SELECT language_constant.resource_name FROM language_constant WHERE language_constant.code = 'lv'",
    );
    targeting = {
      geo: String(geo?.geoTargetConstant?.resourceName ?? "geoTargetConstants/2428"),
      language: String(lang?.languageConstant?.resourceName ?? ""),
    };
    return targeting;
  }

  const metrics = (r: Row) => ({
    impressions: Number(r.metrics?.impressions ?? 0),
    clicks: Number(r.metrics?.clicks ?? 0),
    costMicros: Number(r.metrics?.costMicros ?? 0),
    conversions: Number(r.metrics?.conversions ?? 0),
  });

  async function apply(change: AdsChange): Promise<ApplyResult> {
    switch (change.op) {
      case "create_campaign": {
        const budget = await mutate("campaignBudgets", [
          {
            create: {
              name: `${change.name} budget ${Date.now()}`,
              amountMicros: micros(change.budgetCents),
              deliveryMethod: "STANDARD",
              explicitlyShared: false,
            },
          },
        ]);
        const campaign = await mutate("campaigns", [
          {
            create: {
              name: change.name,
              status: "PAUSED",
              advertisingChannelType: "SEARCH",
              campaignBudget: budget,
              targetSpend: { cpcBidCeilingMicros: micros(change.cpcCapCents) },
              networkSettings: {
                targetGoogleSearch: true,
                targetSearchNetwork: false,
                targetContentNetwork: false,
                targetPartnerSearchNetwork: false,
              },
              containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
            },
          },
        ]);
        const t = await latvia();
        await mutate("campaignCriteria", [
          { create: { campaign, location: { geoTargetConstant: t.geo } } },
          ...(t.language ? [{ create: { campaign, language: { languageConstant: t.language } } }] : []),
        ]);
        return { ok: true, id: campaign, budget };
      }
      case "create_ad_group":
        return {
          ok: true,
          id: await mutate("adGroups", [
            {
              create: {
                name: change.name,
                campaign: change.campaign,
                status: "ENABLED",
                type: "SEARCH_STANDARD",
                cpcBidMicros: micros(change.cpcCapCents),
              },
            },
          ]),
        };
      case "create_keyword":
        return {
          ok: true,
          id: await mutate("adGroupCriteria", [
            {
              create: {
                adGroup: change.adGroup,
                status: "ENABLED",
                keyword: { text: change.text, matchType: MATCH[change.match] },
              },
            },
          ]),
        };
      case "create_negative":
        return {
          ok: true,
          id: await mutate("campaignCriteria", [
            {
              create: {
                campaign: change.campaign,
                negative: true,
                keyword: { text: change.text, matchType: MATCH[change.match] },
              },
            },
          ]),
        };
      case "set_keyword_status":
        await mutate("adGroupCriteria", [
          { update: { resourceName: change.keyword, status: STATUS[change.status] }, updateMask: "status" },
        ]);
        return { ok: true, id: change.keyword };
      case "create_ad":
        return {
          ok: true,
          id: await mutate("adGroupAds", [
            {
              create: {
                adGroup: change.adGroup,
                status: "ENABLED",
                ad: {
                  finalUrls: [change.finalUrl],
                  responsiveSearchAd: {
                    headlines: change.headlines.map((text) => ({ text })),
                    descriptions: change.descriptions.map((text) => ({ text })),
                  },
                },
              },
            },
          ]),
        };
      case "set_budget":
        await mutate("campaignBudgets", [
          {
            update: { resourceName: change.budget, amountMicros: micros(change.cents) },
            updateMask: "amount_micros",
          },
        ]);
        return { ok: true, id: change.budget };
      case "set_cpc":
        await mutate("adGroups", [
          {
            update: { resourceName: change.adGroup, cpcBidMicros: micros(change.cents) },
            updateMask: "cpc_bid_micros",
          },
        ]);
        return { ok: true, id: change.adGroup };
      case "set_campaign_status":
        await mutate("campaigns", [
          { update: { resourceName: change.campaign, status: STATUS[change.status] }, updateMask: "status" },
        ]);
        return { ok: true, id: change.campaign };
      case "upload_image":
        return {
          ok: true,
          id: await mutate("assets", [
            { create: { name: change.name, type: "IMAGE", imageAsset: { data: change.pngBase64 } } },
          ]),
        };
      case "create_pmax":
        return createPmax(change);
    }
  }

  /** Performance Max in one atomic googleAds:mutate with temporary ids (-1 budget, -2 campaign, -3 asset group). */
  async function createPmax(c: Extract<AdsChange, { op: "create_pmax" }>): Promise<ApplyResult> {
    const cid = cfg.customerId;
    const budget = `customers/${cid}/campaignBudgets/-1`;
    const campaign = `customers/${cid}/campaigns/-2`;
    const group = `customers/${cid}/assetGroups/-3`;
    let tmp = -10;
    const text = (t: string) => ({
      resourceName: `customers/${cid}/assets/${tmp--}`,
      textAsset: { text: t },
    });
    const texts = {
      HEADLINE: c.headlines.map(text),
      LONG_HEADLINE: [text(c.longHeadline)],
      DESCRIPTION: c.descriptions.map(text),
      BUSINESS_NAME: [text(c.businessName)],
    };
    const ops: unknown[] = [
      {
        campaignBudgetOperation: {
          create: {
            resourceName: budget,
            name: `${c.name} budget ${Date.now()}`,
            amountMicros: micros(c.budgetCents),
            explicitlyShared: false,
          },
        },
      },
      {
        campaignOperation: {
          create: {
            resourceName: campaign,
            name: c.name,
            status: "PAUSED",
            advertisingChannelType: "PERFORMANCE_MAX",
            campaignBudget: budget,
            maximizeConversions: {},
            containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
          },
        },
      },
      ...Object.values(texts)
        .flat()
        .map((a) => ({ assetOperation: { create: a } })),
      {
        assetGroupOperation: {
          create: { resourceName: group, campaign, name: c.name, finalUrls: [c.finalUrl], status: "ENABLED" },
        },
      },
      ...Object.entries(texts).flatMap(([fieldType, list]) =>
        list.map((a) => ({
          assetGroupAssetOperation: { create: { assetGroup: group, asset: a.resourceName, fieldType } },
        })),
      ),
      ...(
        [
          [c.logo, "LOGO"],
          [c.landscape, "MARKETING_IMAGE"],
          [c.square, "SQUARE_MARKETING_IMAGE"],
        ] as const
      ).map(([asset, fieldType]) => ({
        assetGroupAssetOperation: { create: { assetGroup: group, asset, fieldType } },
      })),
      ...c.searchThemes.slice(0, 25).map((t) => ({
        assetGroupSignalOperation: { create: { assetGroup: group, searchTheme: { text: t } } },
      })),
    ];
    const res = await call("googleAds:mutate", { mutateOperations: ops });
    const results =
      (res.mutateOperationResponses as Record<string, { resourceName?: string }>[] | undefined) ?? [];
    const campaignName = results.map((r) => r.campaignResult?.resourceName).find(Boolean);
    const budgetName = results.map((r) => r.campaignBudgetResult?.resourceName).find(Boolean);
    return { ok: true, id: campaignName, budget: budgetName };
  }

  return {
    name: "google",
    async report(from: string, to: string) {
      const where = `segments.date BETWEEN '${from}' AND '${to}'`;
      const m = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions";
      const [campaigns, groups, keywords, terms] = await Promise.all([
        search(`SELECT segments.date, campaign.resource_name, ${m} FROM campaign WHERE ${where}`),
        search(`SELECT segments.date, ad_group.resource_name, ${m} FROM ad_group WHERE ${where}`),
        search(
          `SELECT segments.date, ad_group_criterion.resource_name, ${m} FROM keyword_view WHERE ${where}`,
        ),
        search(
          `SELECT segments.date, search_term_view.search_term, ad_group.resource_name, ${m} FROM search_term_view WHERE ${where}`,
        ),
      ]);
      const day = (r: Row) => String(r.segments?.date ?? "");
      const stats: StatRow[] = [
        ...campaigns.map((r) => ({
          level: "campaign" as const,
          resource: String(r.campaign?.resourceName),
          day: day(r),
          ...metrics(r),
        })),
        ...groups.map((r) => ({
          level: "ad_group" as const,
          resource: String(r.adGroup?.resourceName),
          day: day(r),
          ...metrics(r),
        })),
        ...keywords.map((r) => ({
          level: "keyword" as const,
          resource: String(r.adGroupCriterion?.resourceName),
          day: day(r),
          ...metrics(r),
        })),
      ];
      const termRows: TermRow[] = terms.map((r) => ({
        day: day(r),
        adGroup: String(r.adGroup?.resourceName),
        term: String(r.searchTermView?.searchTerm ?? ""),
        ...metrics(r),
      }));
      return { stats, terms: termRows };
    },
    async apply(change) {
      try {
        return await apply(change);
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  };
}
