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
export type MetaCreated = { ok: true; id: string } | { ok: false; error: string };

/** A new campaign: the budget sits on it and Meta spreads it over its ads. */
export type NewCampaign = { name: string; dailyBudgetCents: number };
/**
 * A new ad set under a campaign: people in Latvia, optimised for the site's own "Lead" event
 * (an e-mail left), Meta choosing the audience and the placements.
 */
export type NewAdSet = {
  campaignId: string;
  name: string;
  pixelId: string;
  /**
   * Who the ad is for and who pays (the EU's Digital Services Act asks both on every ad set).
   * Meta refuses names that differ from what the ad account has on record (error 100/3858196,
   * "advertiser or payer information"), so the provider first uses the names set here
   * (META_DSA_BENEFICIARY / META_DSA_PAYOR), then the account's defaults, then the names on an
   * ad set the account already runs, and only then `advertiser`.
   */
  advertiser: string;
  dsa?: DsaNames | null;
};

export type DsaNames = { beneficiary: string; payor: string };
/** A new single-image link ad from the page (and its Instagram account when given). */
export type NewAd = {
  adsetId: string;
  name: string;
  pageId: string;
  instagramUserId?: string | null;
  /** Where the ad leads, with its campaign tags already in the address. */
  link: string;
  message: string;
  headline: string;
  description: string;
  imageHash: string;
  /** "trilio.lv": the domain whose pixel counts the ad's results. */
  domain: string;
};

export interface MetaAdsProvider {
  list(): Promise<{ ok: true; entities: MetaEntity[] } | { ok: false; error: string }>;
  /** Per ad and day between two days (YYYY-MM-DD), both included. */
  insights(
    from: string,
    to: string,
  ): Promise<{ ok: true; rows: MetaInsight[] } | { ok: false; error: string }>;
  setDailyBudget(id: string, cents: number): Promise<MetaResult>;
  setStatus(id: string, status: "ACTIVE" | "PAUSED"): Promise<MetaResult>;
  /** Puts a picture into the ad account's library; the id is its hash. */
  uploadImage(jpeg: Buffer): Promise<MetaCreated>;
  createCampaign(input: NewCampaign): Promise<MetaCreated>;
  createAdSet(input: NewAdSet): Promise<MetaCreated>;
  createAd(input: NewAd): Promise<MetaCreated>;
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

  /** A create call on one of the account's edges: form fields, objects as JSON. */
  async function create(edge: string, fields: Record<string, unknown>): Promise<MetaCreated> {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(fields))
      if (v !== undefined && v !== null) form.set(k, typeof v === "string" ? v : JSON.stringify(v));
    try {
      const res = await http(`${base}/act_${cfg.adAccountId}/${edge}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json().catch(() => null)) as Json | null;
      if (!res.ok || !body) return { ok: false, error: metaError(body, res.status) };
      if (edge === "adimages") {
        const first = Object.values((body.images ?? {}) as Record<string, { hash?: string }>)[0];
        return first?.hash
          ? { ok: true, id: first.hash }
          : { ok: false, error: "Meta returned no image hash" };
      }
      const id = text(body.id);
      return id ? { ok: true, id } : { ok: false, error: metaError(body, res.status) };
    } catch (err) {
      return { ok: false, error: `Meta: ${(err as Error).message}`.slice(0, 400) };
    }
  }

  const account = `act_${cfg.adAccountId}`;

  /** One object by its address; null when Meta does not give it. */
  async function one(path: string, params: Record<string, string>): Promise<Json | null> {
    try {
      const res = await http(`${base}/${path}?${new URLSearchParams(params).toString()}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => null)) as Json | null;
      return res.ok && body ? body : null;
    } catch {
      return null;
    }
  }

  /**
   * The advertiser and payer names the ad account already uses: its defaults, else those of
   * an ad set it runs (Meta accepted them there). Null when neither is known.
   */
  async function accountDsa(): Promise<DsaNames | null> {
    const pick = (b: unknown, p: unknown): DsaNames | null => {
      const beneficiary = text(b).trim();
      const payor = text(p).trim() || beneficiary;
      return beneficiary ? { beneficiary, payor } : null;
    };
    const acc = await one(account, { fields: "default_dsa_beneficiary,default_dsa_payor" });
    const fromAccount = acc && pick(acc.default_dsa_beneficiary, acc.default_dsa_payor);
    if (fromAccount) return fromAccount;
    const sets = await all(`${account}/adsets`, { fields: "dsa_beneficiary,dsa_payor", limit: "50" });
    if (typeof sets === "string") return null;
    for (const s of sets) {
      const found = pick(s.dsa_beneficiary, s.dsa_payor);
      if (found) return found;
    }
    return null;
  }

  return {
    uploadImage: (jpeg) => create("adimages", { bytes: jpeg.toString("base64") }),
    createCampaign: (c) =>
      create("campaigns", {
        name: c.name,
        objective: "OUTCOME_LEADS",
        status: "ACTIVE",
        special_ad_categories: [],
        buying_type: "AUCTION",
        daily_budget: String(Math.round(c.dailyBudgetCents)),
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      }),
    async createAdSet(a) {
      const dsa = a.dsa ?? (await accountDsa()) ?? { beneficiary: a.advertiser, payor: a.advertiser };
      const r = await create("adsets", {
        name: a.name,
        campaign_id: a.campaignId,
        status: "ACTIVE",
        billing_event: "IMPRESSIONS",
        optimization_goal: "OFFSITE_CONVERSIONS",
        destination_type: "WEBSITE",
        promoted_object: { pixel_id: a.pixelId, custom_event_type: "LEAD" },
        targeting: { geo_locations: { countries: ["LV"] }, targeting_automation: { advantage_audience: 1 } },
        dsa_beneficiary: dsa.beneficiary,
        dsa_payor: dsa.payor,
      });
      // Which names were sent, so a refusal can be compared with the account's records.
      return r.ok
        ? r
        : {
            ok: false,
            error: `Reklamētājs “${dsa.beneficiary}”, maksātājs “${dsa.payor}”: ${r.error}`.slice(0, 500),
          };
    },
    createAd: (a) =>
      create("ads", {
        name: a.name,
        adset_id: a.adsetId,
        status: "ACTIVE",
        conversion_domain: a.domain,
        creative: {
          name: a.name,
          object_story_spec: {
            page_id: a.pageId,
            ...(a.instagramUserId ? { instagram_user_id: a.instagramUserId } : {}),
            link_data: {
              link: a.link,
              message: a.message,
              name: a.headline,
              description: a.description,
              image_hash: a.imageHash,
              call_to_action: { type: "LEARN_MORE", value: { link: a.link } },
            },
          },
        },
      }),
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
  let next = 9400000000;
  const add = (e: Omit<MetaEntity, "id">, op: string): MetaCreated => {
    const id = String(++next);
    entities.push({ ...e, id });
    calls.push({ op, id, value: e.name });
    return { ok: true, id };
  };
  return {
    calls,
    async uploadImage(jpeg) {
      return jpeg.length ? { ok: true, id: `hash${jpeg.length}` } : { ok: false, error: "empty image" };
    },
    async createCampaign(c) {
      return add(
        {
          level: "campaign",
          name: c.name,
          campaignId: null,
          adsetId: null,
          status: "ACTIVE",
          effectiveStatus: "ACTIVE",
          dailyBudgetCents: c.dailyBudgetCents,
        },
        "campaign",
      );
    },
    async createAdSet(a) {
      return add(
        {
          level: "adset",
          name: a.name,
          campaignId: a.campaignId,
          adsetId: null,
          status: "ACTIVE",
          effectiveStatus: "ACTIVE",
          dailyBudgetCents: null,
        },
        "adset",
      );
    },
    async createAd(a) {
      const set = entities.find((e) => e.id === a.adsetId);
      if (!set) return { ok: false, error: "unknown ad set" };
      return add(
        {
          level: "ad",
          name: a.name,
          campaignId: set.campaignId,
          adsetId: a.adsetId,
          status: "ACTIVE",
          effectiveStatus: "ACTIVE",
          dailyBudgetCents: null,
        },
        "ad",
      );
    },
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
