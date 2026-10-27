import { createSign } from "node:crypto";
import type { AdsChange, AdsProvider, ApplyResult, StatRow, TermRow } from "./provider";

// Google Ads API over REST (docs/GROWTH_PLAN.md §7). Since 9 Sep 2026 access
// belongs to the Google Cloud project (Test → Explorer → Basic → Standard on
// the project's "Google Ads API" page); developer tokens are retired and the
// header is only sent when one is still configured. Credentials, in Google's
// order of preference: a service account of that project (its e-mail is
// added as a user in Google Ads and as an owner in Search Console), or an
// OAuth refresh token of a person with access.
// New campaigns are created PAUSED; the owner switches them on in the admin.
// Money: Google counts micros (1 € = 1 000 000), Trilio cents.

export const DEFAULT_ADS_API_VERSION = "v26";

/** The JSON key of a service account (IAM & Admin → Service accounts → Keys). */
export type ServiceAccountKey = { client_email: string; private_key: string; token_uri?: string };

export type OAuthClient = { clientId: string; clientSecret: string; refreshToken: string };

export type GoogleCredentials =
  { kind: "service_account"; key: ServiceAccountKey } | ({ kind: "oauth" } & OAuthClient);

export type GoogleAdsConfig = {
  credentials: GoogleCredentials;
  /** Retired by Google on 9 Sep 2026; sent only when set, and ignored by the API. */
  developerToken?: string;
  /** The account the ads run in, digits only. */
  customerId: string;
  /** The manager account, digits only; only when the account is reached through a manager. */
  loginCustomerId?: string;
  /** API version path segment, e.g. "v26". */
  version: string;
  siteUrl: string;
};

/** The service account key from GOOGLE_SERVICE_ACCOUNT_KEY: the JSON itself or base64 of it. */
export function serviceAccountFromEnv(raw: string | undefined): ServiceAccountKey | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    const json = text.startsWith("{") ? text : Buffer.from(text, "base64").toString("utf8");
    const key = JSON.parse(json) as Partial<ServiceAccountKey>;
    if (!key.client_email || !key.private_key) return null;
    return { client_email: key.client_email, private_key: key.private_key, token_uri: key.token_uri };
  } catch {
    return null;
  }
}

/** The service account when set, else the OAuth client with a refresh token, else null. */
export function googleCredentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): GoogleCredentials | null {
  const key = serviceAccountFromEnv(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  if (key) return { kind: "service_account", key };
  const { GOOGLE_ADS_CLIENT_ID: clientId, GOOGLE_ADS_CLIENT_SECRET: clientSecret } = env;
  const refreshToken = env.GOOGLE_ADS_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken)
    return { kind: "oauth", clientId, clientSecret, refreshToken };
  return null;
}

export function googleAdsConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GoogleAdsConfig | null {
  const digits = (v?: string) => v?.replace(/\D/g, "") || undefined;
  const credentials = googleCredentialsFromEnv(env);
  const customerId = digits(env.GOOGLE_ADS_CUSTOMER_ID);
  if (!credentials || !customerId) return null;
  return {
    credentials,
    developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN || undefined,
    customerId,
    loginCustomerId: digits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
    version: env.GOOGLE_ADS_API_VERSION || DEFAULT_ADS_API_VERSION,
    siteUrl: (env.APP_URL || "https://trilio.lv").replace(/\/$/, ""),
  };
}

type Fetch = typeof fetch;

export const ADWORDS_SCOPE = "https://www.googleapis.com/auth/adwords";
export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** A signed JWT assertion for the service-account token exchange (RFC 7523). */
export function serviceAccountAssertion(key: ServiceAccountKey, scope: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope,
      aud: key.token_uri ?? "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(key.private_key);
  return `${head}.${claims}.${b64url(signature)}`;
}

/** An OAuth access token for the credentials, cached until a minute before it expires. */
export function googleTokenSource(credentials: GoogleCredentials, scope: string, fetchImpl: Fetch = fetch) {
  let cached: { token: string; until: number } | null = null;
  return async (): Promise<string> => {
    if (cached && cached.until > Date.now()) return cached.token;
    const body =
      credentials.kind === "service_account"
        ? new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: serviceAccountAssertion(credentials.key, scope),
          })
        : new URLSearchParams({
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            refresh_token: credentials.refreshToken,
            grant_type: "refresh_token",
          });
    const url =
      credentials.kind === "service_account"
        ? (credentials.key.token_uri ?? "https://oauth2.googleapis.com/token")
        : "https://oauth2.googleapis.com/token";
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`google sign-in ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: json.access_token, until: Date.now() + (json.expires_in - 60) * 1000 };
    return json.access_token;
  };
}

/** Google's error text, with a plain explanation for the access-level refusal. */
export function explainAdsError(status: number, text: string): string {
  if (text.includes("CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION"))
    return 'Google Cloud projektam ir tikai Test piekļuve: Google Cloud konsolē, lapā "Google Ads API", piesakies Explorer piekļuvei.';
  if (text.includes("USER_PERMISSION_DENIED"))
    return "Servisa kontam vai lietotājam nav piekļuves šim Google Ads kontam: pievieno tā e-pastu Google Ads sadaļā Admin → Access and security.";
  return `google ads ${status}: ${text.slice(0, 500)}`;
}

const micros = (cents: number) => String(cents * 10_000);
const MATCH = { exact: "EXACT", phrase: "PHRASE", broad: "BROAD" } as const;
const STATUS = { enabled: "ENABLED", paused: "PAUSED" } as const;

type Row = Record<string, Record<string, unknown> | undefined>;

export function googleAdsProvider(cfg: GoogleAdsConfig, fetchImpl: Fetch = fetch): AdsProvider {
  const token = googleTokenSource(cfg.credentials, ADWORDS_SCOPE, fetchImpl);
  const base = `https://googleads.googleapis.com/${cfg.version}/customers/${cfg.customerId}`;

  async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetchImpl(`${base}/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await token()}`,
        ...(cfg.developerToken ? { "developer-token": cfg.developerToken } : {}),
        ...(cfg.loginCustomerId ? { "login-customer-id": cfg.loginCustomerId } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(explainAdsError(res.status, text));
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
    };
    // Brand guidelines are on by default for new Performance Max campaigns
    // (API v21+): the business name and the logo are linked to the campaign,
    // not to the asset group, or the request fails with
    // REQUIRED_BUSINESS_NAME_ASSET_NOT_LINKED.
    const businessName = text(c.businessName);
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
      ...[...Object.values(texts).flat(), businessName].map((a) => ({ assetOperation: { create: a } })),
      ...(
        [
          [businessName.resourceName, "BUSINESS_NAME"],
          [c.logo, "LOGO"],
        ] as const
      ).map(([asset, fieldType]) => ({ campaignAssetOperation: { create: { campaign, asset, fieldType } } })),
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
      const [account, campaigns, groups, keywords, terms] = await Promise.all([
        // The account total, so the admin matches the Google Ads overview, also for campaigns made there.
        search(`SELECT segments.date, customer.resource_name, ${m} FROM customer WHERE ${where}`),
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
        ...account.map((r) => ({
          level: "account" as const,
          resource: String(r.customer?.resourceName ?? `customers/${cfg.customerId}`),
          day: day(r),
          ...metrics(r),
        })),
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
