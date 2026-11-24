// Meta's Marketing API for Trilio's ad account (docs/GROWTH_PLAN.md, "One agent for every
// channel"): read the campaigns, ad sets and ads with their daily numbers, set a daily budget,
// pause or resume. The same system-user token and ad account as the page's posts
// (META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID); the token needs ads_read to read and
// ads_management to change. Endpoints and fields as in Meta's reference (read 24 Nov 2026):
//   GET  act_<id>/campaigns | adsets | ads   fields=id,name,status,effective_status,daily_budget,…
//   GET  act_<id>/insights                   level=ad, time_increment=1, time_range={since,until}
//   POST <id>                                daily_budget=<cents> | status=ACTIVE|PAUSED
// Budgets are in the account currency's smallest unit (cents); `spend` comes back as a decimal
// string in the currency itself. Errors come back as text, never as exceptions.

export type MetaLevel = "campaign" | "adset" | "ad";

export type MetaEntity = {
  id: string;
  level: MetaLevel;
  name: string;
  campaignId: string | null;
  adsetId: string | null;
  /** What was set: ACTIVE, PAUSED, … */
  status: string;
  /** What runs: ACTIVE, PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED, DISAPPROVED, … */
  effectiveStatus: string;
  /** Null where the budget does not sit (it is on the campaign or on the ad set, never both). */
  dailyBudgetCents: number | null;
};

export type MetaInsight = {
  day: string;
  adId: string;
  campaignId: string;
  spendCents: number;
  impressions: number;
  linkClicks: number;
};

export type MetaResult = { ok: true } | { ok: false; error: string };

export interface MetaAdsProvider {
  list(): Promise<{ ok: true; entities: MetaEntity[] } | { ok: false; error: string }>;
  /** Per ad and day between two days (YYYY-MM-DD), both included. */
  insights(
    from: string,
    to: string,
  ): Promise<{ ok: true; rows: MetaInsight[] } | { ok: false; error: string }>;
  setDailyBudget(id: string, cents: number): Promise<MetaResult>;
  setStatus(id: string, status: "ACTIVE" | "PAUSED"): Promise<MetaResult>;
}

export type MetaAdsConfig = { adAccountId: string; token: string; version: string };

export function metaAdsConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): MetaAdsConfig | null {
  const adAccountId = env.META_AD_ACCOUNT_ID?.trim().replace(/^act_/, "");
  const token = env.META_SYSTEM_USER_TOKEN?.trim();
  if (!adAccountId || !/^\d{5,20}$/.test(adAccountId) || !token) return null;
  return { adAccountId, token, version: env.META_GRAPH_VERSION?.trim() || "v23.0" };
}

type Json = Record<string, unknown>;
const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
/** A whole number of cents from Meta's budget string ("500"); null when there is no budget. */
const budget = (v: unknown): number | null => {
  const n = Number(text(v));
  return text(v) !== "" && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
/** "12.34" in euro → 1234 cents. */
export const spendToCents = (v: unknown): number => {
  const n = Number(text(v));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};
const count = (v: unknown): number => {
  const n = Number(text(v));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Meta's error as one line: its message, the text meant for the user, and its code. */
export function metaError(body: unknown, status: number): string {
  const e = (body as { error?: Json } | null)?.error;
  if (!e) return `Meta HTTP ${status}`;
  const user = text(e.error_user_msg);
  return `${text(e.message) || "Meta error"}${user ? ` (${user})` : ""} [${text(e.code)}${
    e.error_subcode ? `/${text(e.error_subcode)}` : ""
  }]`.slice(0, 400);
}

const MAX_PAGES = 20;

export function metaAdsProvider(cfg: MetaAdsConfig, http: typeof fetch = fetch): MetaAdsProvider {
  const base = `https://graph.facebook.com/${cfg.version}`;
  const headers = { authorization: `Bearer ${cfg.token}` };

  /** Every page of a listing: Meta gives the next page's address in `paging.next`. */
  async function all(path: string, params: Record<string, string>): Promise<Json[] | string> {
    let url: string | null = `${base}/${path}?${new URLSearchParams(params).toString()}`;
    const rows: Json[] = [];
    for (let page = 0; url && page < MAX_PAGES; page++) {
      let res: Response;
      try {
        res = await http(url, { headers, signal: AbortSignal.timeout(30_000) });
      } catch (err) {
        return `Meta: ${(err as Error).message}`.slice(0, 400);
      }
      const body = (await res.json().catch(() => null)) as {
        data?: Json[];
        paging?: { next?: string };
      } | null;
      if (!res.ok || !body || !Array.isArray(body.data)) return metaError(body, res.status);
      rows.push(...body.data);
      const next = body.paging?.next;
      // Only Meta's own next page is followed.
      url = typeof next === "string" && next.startsWith(`${base}/`) ? next : null;
    }
    return rows;
  }

  async function post(id: string, fields: Record<string, string>): Promise<MetaResult> {
    if (!/^\d{5,30}$/.test(id)) return { ok: false, error: "not a Meta id" };
    try {
      const res = await http(`${base}/${id}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
      return res.ok && body?.success !== false
        ? { ok: true }
        : { ok: false, error: metaError(body, res.status) };
    } catch (err) {
      return { ok: false, error: `Meta: ${(err as Error).message}`.slice(0, 400) };
    }
  }

  const account = `act_${cfg.adAccountId}`;
  return {
    async list() {
      const common = "id,name,status,effective_status";
      const [campaigns, adsets, ads] = await Promise.all([
        all(`${account}/campaigns`, { fields: `${common},daily_budget`, limit: "200" }),
        all(`${account}/adsets`, { fields: `${common},daily_budget,campaign_id`, limit: "200" }),
        all(`${account}/ads`, { fields: `${common},adset_id,campaign_id`, limit: "200" }),
      ]);
      for (const r of [campaigns, adsets, ads]) if (typeof r === "string") return { ok: false, error: r };
      const entity =
        (level: MetaLevel) =>
        (r: Json): MetaEntity => ({
          id: text(r.id),
          level,
          name: text(r.name).slice(0, 300),
          campaignId: level === "campaign" ? null : text(r.campaign_id) || null,
          adsetId: level === "ad" ? text(r.adset_id) || null : null,
          status: text(r.status) || "PAUSED",
          effectiveStatus: text(r.effective_status) || text(r.status) || "PAUSED",
          dailyBudgetCents: level === "ad" ? null : budget(r.daily_budget),
        });
      return {
        ok: true,
        entities: [
          ...(campaigns as Json[]).map(entity("campaign")),
          ...(adsets as Json[]).map(entity("adset")),
          ...(ads as Json[]).map(entity("ad")),
        ].filter((e) => e.id),
      };
    },
    async insights(from, to) {
      const rows = await all(`${account}/insights`, {
        level: "ad",
        time_increment: "1",
        time_range: JSON.stringify({ since: from, until: to }),
        fields: "ad_id,campaign_id,spend,impressions,inline_link_clicks,date_start",
        limit: "500",
      });
      if (typeof rows === "string") return { ok: false, error: rows };
      return {
        ok: true,
        rows: rows
          .map((r) => ({
            day: text(r.date_start),
            adId: text(r.ad_id),
            campaignId: text(r.campaign_id),
            spendCents: spendToCents(r.spend),
            impressions: count(r.impressions),
            linkClicks: count(r.inline_link_clicks),
          }))
          .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && r.adId && r.campaignId),
      };
    },
    setDailyBudget: (id, cents) => post(id, { daily_budget: String(Math.round(cents)) }),
    setStatus: (id, status) => post(id, { status }),
  };
}

/**
 * A stand-in account for tests and local runs (ADS_PROVIDER=mock): one campaign with its budget
 * on the campaign and two ads. Changes are remembered, so a second read shows them.
 */
export function mockMetaAds(
  seed: { entities?: MetaEntity[]; insights?: MetaInsight[] } = {},
): MetaAdsProvider & { calls: { op: string; id: string; value: string | number }[] } {
  const entities: MetaEntity[] = seed.entities ?? [
    {
      id: "9100000001",
      level: "campaign",
      name: "Trilio Leads",
      campaignId: null,
      adsetId: null,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      dailyBudgetCents: 1500,
    },
    {
      id: "9200000001",
      level: "adset",
      name: "Latvija",
      campaignId: "9100000001",
      adsetId: null,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      dailyBudgetCents: null,
    },
    {
      id: "9300000001",
      level: "ad",
      name: "A1 trīs varianti",
      campaignId: "9100000001",
      adsetId: "9200000001",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      dailyBudgetCents: null,
    },
    {
      id: "9300000002",
      level: "ad",
      name: "A2 pajautā cenu",
      campaignId: "9100000001",
      adsetId: "9200000001",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      dailyBudgetCents: null,
    },
  ];
  const calls: { op: string; id: string; value: string | number }[] = [];
  return {
    calls,
    async list() {
      return { ok: true, entities: entities.map((e) => ({ ...e })) };
    },
    async insights(from, to) {
      return { ok: true, rows: (seed.insights ?? []).filter((r) => r.day >= from && r.day <= to) };
    },
    async setDailyBudget(id, cents) {
      const e = entities.find((x) => x.id === id);
      if (!e) return { ok: false, error: "unknown id" };
      e.dailyBudgetCents = cents;
      calls.push({ op: "budget", id, value: cents });
      return { ok: true };
    },
    async setStatus(id, status) {
      const e = entities.find((x) => x.id === id);
      if (!e) return { ok: false, error: "unknown id" };
      e.status = status;
      e.effectiveStatus = status;
      calls.push({ op: "status", id, value: status });
      return { ok: true };
    },
  };
}

/** Meta ads are managed when ads are on and the ad account is configured (or the mock runs). */
export function metaAdsFromEnv(
  env: Record<string, string | undefined> = process.env,
): MetaAdsProvider | null {
  if (env.FEATURE_ADS !== "1") return null;
  if (env.ADS_PROVIDER === "mock") return mockMetaAds();
  const cfg = metaAdsConfigFromEnv(env);
  return cfg ? metaAdsProvider(cfg) : null;
}
