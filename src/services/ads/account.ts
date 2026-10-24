import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  adAds,
  adCampaigns,
  adChanges,
  adDailyStats,
  adGroups,
  adKeywords,
  adLandings,
  adProposals,
  adSearchTerms,
  adSettings,
  affiliateClicks,
  savedItems,
  type AdProposal,
  type AdSettings,
} from "@/db/schema";
import seed from "../../../data/keywords.lv.json";
import { rigaDay } from "@/domain/analytics/visits";
import { pacedBudget, splitBudget, type Performance } from "@/domain/ads/budget";
import type { AccountState, Proposal } from "@/domain/ads/guardrails";
import { buildCampaignPlan } from "@/domain/ads/plan";
import { catalog } from "@/domain/questions/catalog";
import type { AdsChange, AdsProvider, ApplyResult, Known } from "./provider";

// Trilio's copy of the ads account (docs/GROWTH_PLAN.md §6–7): the owner's
// settings, the campaigns built from categories.json and keywords.lv.json,
// Google's daily numbers, and every change sent, by our own ids. Google is
// told only through the provider, and each call is logged in ad_changes.

export async function getSettings(db: Db): Promise<AdSettings> {
  const [row] = await db.select().from(adSettings).where(eq(adSettings.id, 1));
  if (row) return row;
  const [created] = await db.insert(adSettings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(adSettings).where(eq(adSettings.id, 1)))[0]!;
}

export async function updateSettings(
  db: Db,
  patch: Partial<Omit<AdSettings, "id" | "updatedAt">>,
): Promise<AdSettings> {
  await getSettings(db);
  const [row] = await db
    .update(adSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(adSettings.id, 1))
    .returning();
  return row!;
}

async function logChange(db: Db, change: AdsChange, result: ApplyResult, proposalId?: string | null) {
  // Image bytes are not worth keeping in the log.
  const operation = change.op === "upload_image" ? { op: change.op, name: change.name } : change;
  await db.insert(adChanges).values({
    proposalId: proposalId ?? null,
    operation: operation as unknown as Record<string, unknown>,
    ok: result.ok,
    response: result.ok ? (result.id ?? null) : result.error.slice(0, 1000),
  });
}

/** Sends one change and logs it. */
export async function send(db: Db, provider: AdsProvider, change: AdsChange, proposalId?: string | null) {
  const result = await provider.apply(change);
  await logChange(db, change, result, proposalId);
  return result;
}

/** The first Search campaigns as drafts in Trilio's tables; existing campaigns are left as they are. */
export async function buildCampaigns(
  db: Db,
): Promise<{ campaigns: number; adGroups: number; keywords: number }> {
  const settings = await getSettings(db);
  const plan = buildCampaignPlan(catalog, seed, settings.dailyBudgetCents);
  const counts = { campaigns: 0, adGroups: 0, keywords: 0 };
  for (const c of plan) {
    const [campaign] = await db
      .insert(adCampaigns)
      .values({ name: c.name, groupId: c.groupId, budgetCents: c.budgetCents })
      .onConflictDoNothing()
      .returning();
    if (!campaign) continue;
    counts.campaigns++;
    await db
      .insert(adKeywords)
      .values(
        c.negatives.map((text) => ({
          campaignId: campaign.id,
          text,
          match: "phrase" as const,
          negative: true,
        })),
      )
      .onConflictDoNothing();
    for (const g of c.adGroups) {
      const [group] = await db
        .insert(adGroups)
        .values({
          campaignId: campaign.id,
          subcategoryId: g.subcategoryId,
          name: g.name,
          landingPath: g.landingPath,
        })
        .returning();
      counts.adGroups++;
      await db
        .insert(adKeywords)
        .values(
          g.keywords.map((text) => ({
            campaignId: campaign.id,
            adGroupId: group!.id,
            text,
            match: "phrase" as const,
          })),
        )
        .onConflictDoNothing();
      counts.keywords += g.keywords.length;
      await db.insert(adAds).values({ adGroupId: group!.id, ...g.ad, finalPath: g.landingPath });
    }
  }
  return counts;
}

export function siteUrl(): string {
  return (process.env.APP_URL || "https://trilio.lv").replace(/\/$/, "");
}

/**
 * Creates in the platform whatever exists only in Trilio's tables. New
 * campaigns arrive paused; ad groups, keywords and ads arrive enabled
 * under them, so nothing runs until the owner switches a campaign on.
 */
export async function syncAccount(
  db: Db,
  provider: AdsProvider,
): Promise<{ created: number; failed: number }> {
  let created = 0;
  let failed = 0;
  const tally = (r: ApplyResult) => (r.ok ? created++ : failed++);
  for (const c of await db
    .select()
    .from(adCampaigns)
    .where(and(isNull(adCampaigns.googleId), eq(adCampaigns.kind, "search")))) {
    const r = await send(db, provider, {
      op: "create_campaign",
      name: c.name,
      budgetCents: c.budgetCents,
      cpcCapCents: 30,
    });
    tally(r);
    if (r.ok)
      await db
        .update(adCampaigns)
        .set({
          googleId: r.id ?? null,
          budgetGoogleId: r.budget ?? null,
          status: "paused",
          syncedAt: new Date(),
        })
        .where(eq(adCampaigns.id, c.id));
  }
  const groups = await db
    .select({ g: adGroups, campaign: adCampaigns.googleId })
    .from(adGroups)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adGroups.campaignId))
    .where(and(isNull(adGroups.googleId), isNotNull(adCampaigns.googleId)));
  for (const { g, campaign } of groups) {
    const r = await send(db, provider, {
      op: "create_ad_group",
      campaign: campaign!,
      name: g.name,
      cpcCapCents: g.cpcCapCents,
    });
    tally(r);
    if (r.ok)
      await db
        .update(adGroups)
        .set({ googleId: r.id ?? null, status: "enabled" })
        .where(eq(adGroups.id, g.id));
  }
  const keywords = await db
    .select({ k: adKeywords, group: adGroups.googleId, campaign: adCampaigns.googleId })
    .from(adKeywords)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adKeywords.campaignId))
    .leftJoin(adGroups, eq(adGroups.id, adKeywords.adGroupId))
    .where(
      and(
        isNull(adKeywords.googleId),
        isNotNull(adCampaigns.googleId),
        sql`${adKeywords.status} <> 'removed'`,
      ),
    );
  for (const { k, group, campaign } of keywords) {
    if (!k.negative && !group) continue;
    const r = k.negative
      ? await send(db, provider, { op: "create_negative", campaign: campaign!, text: k.text, match: k.match })
      : await send(db, provider, { op: "create_keyword", adGroup: group!, text: k.text, match: k.match });
    tally(r);
    if (r.ok)
      await db
        .update(adKeywords)
        .set({ googleId: r.id ?? null, status: k.status === "paused" ? "paused" : "enabled" })
        .where(eq(adKeywords.id, k.id));
  }
  const ads = await db
    .select({ a: adAds, group: adGroups.googleId })
    .from(adAds)
    .innerJoin(adGroups, eq(adGroups.id, adAds.adGroupId))
    .where(and(isNull(adAds.googleId), isNotNull(adGroups.googleId), eq(adAds.status, "draft")));
  for (const { a, group } of ads) {
    const r = await send(db, provider, {
      op: "create_ad",
      adGroup: group!,
      headlines: a.headlines,
      descriptions: a.descriptions,
      finalUrl: `${siteUrl()}${a.finalPath}`,
    });
    tally(r);
    if (r.ok)
      await db
        .update(adAds)
        .set({ googleId: r.id ?? null, status: "enabled" })
        .where(eq(adAds.id, a.id));
  }
  return { created, failed };
}

/** Switches synced campaigns on or off ("Ieslēgt" / "Apturēt visu"). */
export async function setCampaignsStatus(
  db: Db,
  provider: AdsProvider,
  status: "enabled" | "paused",
  campaignId?: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(adCampaigns)
    .where(and(isNotNull(adCampaigns.googleId), campaignId ? eq(adCampaigns.id, campaignId) : undefined));
  let n = 0;
  for (const c of rows) {
    const r = await send(db, provider, { op: "set_campaign_status", campaign: c.googleId!, status });
    if (r.ok) {
      n++;
      await db.update(adCampaigns).set({ status }).where(eq(adCampaigns.id, c.id));
    }
  }
  return n;
}

async function known(
  db: Db,
): Promise<{ known: Known; byResource: Map<string, { level: string; id: string }> }> {
  const campaigns = await db
    .select({ id: adCampaigns.id, g: adCampaigns.googleId })
    .from(adCampaigns)
    .where(isNotNull(adCampaigns.googleId));
  const groups = await db
    .select({ id: adGroups.id, g: adGroups.googleId })
    .from(adGroups)
    .where(isNotNull(adGroups.googleId));
  const keywords = await db
    .select({ id: adKeywords.id, g: adKeywords.googleId, text: adKeywords.text, group: adGroups.googleId })
    .from(adKeywords)
    .innerJoin(adGroups, eq(adGroups.id, adKeywords.adGroupId))
    .where(
      and(isNotNull(adKeywords.googleId), eq(adKeywords.negative, false), eq(adKeywords.status, "enabled")),
    );
  const byResource = new Map<string, { level: string; id: string }>();
  for (const c of campaigns) byResource.set(c.g!, { level: "campaign", id: c.id });
  for (const g of groups) byResource.set(g.g!, { level: "ad_group", id: g.id });
  for (const k of keywords) byResource.set(k.g!, { level: "keyword", id: k.id });
  return {
    known: {
      campaigns: campaigns.filter((c) => c.g).map((c) => c.g!),
      adGroups: groups.map((g) => g.g!),
      keywords: keywords.map((k) => ({ resource: k.g!, adGroup: k.group!, text: k.text })),
    },
    byResource,
  };
}

/** Pulls the platform's numbers for [from, to] into ad_daily_stats and ad_search_terms. */
export async function pullReports(db: Db, provider: AdsProvider, from: string, to: string) {
  const { known: k, byResource } = await known(db);
  if (k.campaigns.length === 0) return { stats: 0, terms: 0 };
  const { stats, terms } = await provider.report(from, to, k);
  const statRows = stats.flatMap((r) => {
    const own = byResource.get(r.resource);
    if (!own || !r.day) return [];
    return [
      {
        day: r.day,
        level: own.level,
        entityId: own.id,
        impressions: r.impressions,
        clicks: r.clicks,
        costMicros: r.costMicros,
        conversions: r.conversions,
      },
    ];
  });
  // Several rows of one search term can come back for a day (different match types): summed.
  const termMap = new Map<string, typeof adSearchTerms.$inferInsert>();
  for (const r of terms) {
    const own = byResource.get(r.adGroup);
    if (!own || own.level !== "ad_group" || !r.term) continue;
    const term = r.term.toLowerCase().slice(0, 200);
    const key = `${r.day}|${own.id}|${term}`;
    const prev = termMap.get(key);
    termMap.set(key, {
      day: r.day,
      adGroupId: own.id,
      term,
      impressions: (prev?.impressions ?? 0) + r.impressions,
      clicks: (prev?.clicks ?? 0) + r.clicks,
      costMicros: (prev?.costMicros ?? 0) + r.costMicros,
      conversions: (prev?.conversions ?? 0) + r.conversions,
    });
  }
  const metricsSet = {
    impressions: sql`excluded.impressions`,
    clicks: sql`excluded.clicks`,
    costMicros: sql`excluded.cost_micros`,
    conversions: sql`excluded.conversions`,
  };
  for (let i = 0; i < statRows.length; i += 500)
    await db
      .insert(adDailyStats)
      .values(statRows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [adDailyStats.day, adDailyStats.level, adDailyStats.entityId],
        set: metricsSet,
      });
  const termRows = [...termMap.values()];
  for (let i = 0; i < termRows.length; i += 500)
    await db
      .insert(adSearchTerms)
      .values(termRows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [adSearchTerms.day, adSearchTerms.adGroupId, adSearchTerms.term],
        set: metricsSet,
      });
  const s = statRows.length;
  const t = termRows.length;
  return { stats: s, terms: t };
}

export const dayOffset = (now: Date, days: number) => rigaDay(new Date(now.getTime() - days * 86_400_000));

/** Spend from Google and conversions from Trilio's own counts, over the last 7 days. */
export async function performance(db: Db, now = new Date()): Promise<Performance> {
  // Seven days up to today: Google's spend for today arrives tomorrow, Trilio's own counts are live.
  const from = dayOffset(now, 6);
  const to = dayOffset(now, 0);
  const [cost] = await db
    .select({ micros: sql<number>`coalesce(sum(${adDailyStats.costMicros}), 0)::bigint` })
    .from(adDailyStats)
    .where(and(eq(adDailyStats.level, "campaign"), gte(adDailyStats.day, from), lte(adDailyStats.day, to)));
  const conv = await conversionsByDay(db, from, to);
  return {
    cost7dCents: Math.round(Number(cost?.micros ?? 0) / 10_000),
    shopClicks7d: conv.reduce((a, r) => a + r.shopClicks, 0),
    saves7d: conv.reduce((a, r) => a + r.saves, 0),
  };
}

/** Shop clicks and saves credited to ad visits, per day and campaign tag. */
export async function conversionsByDay(db: Db, from: string, to: string) {
  const clicks = await db
    .select({ day: adLandings.day, campaign: adLandings.utmCampaign, n: sql<number>`count(*)::int` })
    .from(affiliateClicks)
    .innerJoin(adLandings, eq(adLandings.id, affiliateClicks.adLandingId))
    .where(and(gte(adLandings.day, from), lte(adLandings.day, to)))
    .groupBy(adLandings.day, adLandings.utmCampaign);
  const saves = await db
    .select({ day: adLandings.day, campaign: adLandings.utmCampaign, n: sql<number>`count(*)::int` })
    .from(savedItems)
    .innerJoin(adLandings, eq(adLandings.id, savedItems.adLandingId))
    .where(and(gte(adLandings.day, from), lte(adLandings.day, to)))
    .groupBy(adLandings.day, adLandings.utmCampaign);
  const landings = await db
    .select({ day: adLandings.day, campaign: adLandings.utmCampaign, n: sql<number>`count(*)::int` })
    .from(adLandings)
    .where(and(gte(adLandings.day, from), lte(adLandings.day, to)))
    .groupBy(adLandings.day, adLandings.utmCampaign);
  const key = (d: string, c: string | null) => `${d}|${c ?? ""}`;
  const out = new Map<
    string,
    { day: string; campaign: string | null; visits: number; shopClicks: number; saves: number }
  >();
  const row = (d: string, c: string | null) => {
    const k = key(String(d), c);
    if (!out.has(k)) out.set(k, { day: String(d), campaign: c, visits: 0, shopClicks: 0, saves: 0 });
    return out.get(k)!;
  };
  for (const r of landings) row(r.day, r.campaign).visits += Number(r.n);
  for (const r of clicks) row(r.day, r.campaign).shopClicks += Number(r.n);
  for (const r of saves) row(r.day, r.campaign).saves += Number(r.n);
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** The account as the guardrails see it. */
export async function accountState(db: Db, now = new Date()): Promise<AccountState> {
  const settings = await getSettings(db);
  const campaigns = await db.select().from(adCampaigns);
  const groups = await db.select().from(adGroups);
  const keywords = await db.select().from(adKeywords);
  const from = dayOffset(now, 28);
  const converting = await db
    .select({ term: adSearchTerms.term })
    .from(adSearchTerms)
    .where(and(gte(adSearchTerms.day, from), sql`${adSearchTerms.conversions} > 0`))
    .groupBy(adSearchTerms.term);
  const convertingKeywords = await db
    .select({ text: adKeywords.text })
    .from(adDailyStats)
    .innerJoin(adKeywords, eq(adKeywords.id, adDailyStats.entityId))
    .where(
      and(
        eq(adDailyStats.level, "keyword"),
        gte(adDailyStats.day, from),
        sql`${adDailyStats.conversions} > 0`,
      ),
    )
    .groupBy(adKeywords.text);
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const [applied] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adProposals)
    .where(and(eq(adProposals.status, "applied"), gte(adProposals.decidedAt, start)));
  return {
    paused: settings.paused,
    campaigns: new Map(campaigns.map((c) => [c.id, { budgetCents: c.budgetCents, status: c.status }])),
    adGroups: new Map(groups.map((g) => [g.id, { campaignId: g.campaignId, cpcCapCents: g.cpcCapCents }])),
    keywords: new Map(
      keywords.map((k) => [
        k.id,
        {
          adGroupId: k.adGroupId,
          campaignId: k.campaignId,
          text: k.text,
          negative: k.negative,
          status: k.status,
        },
      ]),
    ),
    convertingTerms: [
      ...new Set([...converting.map((r) => r.term), ...convertingKeywords.map((r) => r.text.toLowerCase())]),
    ],
    appliedToday: Number(applied?.n ?? 0),
  };
}

/** Carries out one checked proposal in the platform and in Trilio's tables. */
export async function applyProposal(
  db: Db,
  provider: AdsProvider,
  row: AdProposal,
  p: Proposal,
  decidedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  const done = async (ok: boolean, error?: string) => {
    await db
      .update(adProposals)
      .set({
        status: ok ? "applied" : "failed",
        blockReason: error ?? null,
        decidedBy,
        decidedAt: new Date(),
      })
      .where(eq(adProposals.id, row.id));
    return { ok, error };
  };
  switch (p.action) {
    case "flag_landing":
      return done(true);
    case "add_negative": {
      const [c] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, p.campaignId));
      const r = c?.googleId
        ? await send(
            db,
            provider,
            { op: "create_negative", campaign: c.googleId, text: p.text, match: p.match },
            row.id,
          )
        : ({ ok: true } as ApplyResult);
      if (!r.ok) return done(false, r.error);
      await db
        .insert(adKeywords)
        .values({
          campaignId: p.campaignId,
          text: p.text,
          match: p.match,
          negative: true,
          source: "agent",
          status: c?.googleId ? "enabled" : "draft",
          googleId: r.ok ? (r.id ?? null) : null,
        })
        .onConflictDoNothing();
      return done(true);
    }
    case "pause_keyword":
    case "enable_keyword": {
      const status = p.action === "pause_keyword" ? "paused" : "enabled";
      const [k] = await db.select().from(adKeywords).where(eq(adKeywords.id, p.keywordId));
      if (k?.googleId) {
        const r = await send(db, provider, { op: "set_keyword_status", keyword: k.googleId, status }, row.id);
        if (!r.ok) return done(false, r.error);
      }
      await db.update(adKeywords).set({ status }).where(eq(adKeywords.id, p.keywordId));
      return done(true);
    }
    case "add_keyword": {
      const [g] = await db.select().from(adGroups).where(eq(adGroups.id, p.adGroupId));
      const r = g?.googleId
        ? await send(
            db,
            provider,
            { op: "create_keyword", adGroup: g.googleId, text: p.text, match: p.match },
            row.id,
          )
        : ({ ok: true } as ApplyResult);
      if (!r.ok) return done(false, r.error);
      await db
        .insert(adKeywords)
        .values({
          campaignId: g!.campaignId,
          adGroupId: p.adGroupId,
          text: p.text,
          match: p.match,
          source: "agent",
          status: g?.googleId ? "enabled" : "draft",
          googleId: r.id ?? null,
        })
        .onConflictDoNothing();
      return done(true);
    }
    case "set_cpc": {
      const [g] = await db.select().from(adGroups).where(eq(adGroups.id, p.adGroupId));
      if (g?.googleId) {
        const r = await send(
          db,
          provider,
          { op: "set_cpc", adGroup: g.googleId, cents: p.cpcCapCents },
          row.id,
        );
        if (!r.ok) return done(false, r.error);
      }
      await db.update(adGroups).set({ cpcCapCents: p.cpcCapCents }).where(eq(adGroups.id, p.adGroupId));
      return done(true);
    }
    case "move_budget": {
      const rows = await db
        .select()
        .from(adCampaigns)
        .where(inArray(adCampaigns.id, [p.fromCampaignId, p.toCampaignId]));
      const from = rows.find((c) => c.id === p.fromCampaignId)!;
      const to = rows.find((c) => c.id === p.toCampaignId)!;
      for (const [c, cents] of [
        [from, from.budgetCents - p.cents],
        [to, to.budgetCents + p.cents],
      ] as const) {
        if (c.budgetGoogleId) {
          const r = await send(db, provider, { op: "set_budget", budget: c.budgetGoogleId, cents }, row.id);
          if (!r.ok) return done(false, r.error);
        }
        await db.update(adCampaigns).set({ budgetCents: cents }).where(eq(adCampaigns.id, c.id));
      }
      return done(true);
    }
    case "new_ad": {
      const [g] = await db.select().from(adGroups).where(eq(adGroups.id, p.adGroupId));
      let googleId: string | null = null;
      if (g?.googleId) {
        const r = await send(
          db,
          provider,
          {
            op: "create_ad",
            adGroup: g.googleId,
            headlines: p.headlines,
            descriptions: p.descriptions,
            finalUrl: `${siteUrl()}${g.landingPath}`,
          },
          row.id,
        );
        if (!r.ok) return done(false, r.error);
        googleId = r.id ?? null;
      }
      await db.insert(adAds).values({
        adGroupId: p.adGroupId,
        headlines: p.headlines,
        descriptions: p.descriptions,
        finalPath: g!.landingPath,
        googleId,
        status: googleId ? "enabled" : "draft",
        source: "agent",
      });
      return done(true);
    }
  }
}

/**
 * Sets tomorrow's total by the pacing rule (code, not Claude) and scales every
 * synced campaign's budget to it, keeping their shares. Returns the new total.
 */
export async function paceBudgets(
  db: Db,
  provider: AdsProvider,
  now = new Date(),
): Promise<{ cents: number; why: string }> {
  const settings = await getSettings(db);
  const campaigns = await db
    .select()
    .from(adCampaigns)
    .where(sql`${adCampaigns.status} <> 'removed'`);
  if (campaigns.length === 0) return { cents: 0, why: "no campaigns" };
  const current = campaigns.reduce((a, c) => a + c.budgetCents, 0);
  const paced = pacedBudget(current, await performance(db, now), settings);
  if (paced.cents === current) return paced;
  const split = splitBudget(
    paced.cents,
    Object.fromEntries(campaigns.map((c) => [c.id, c.budgetCents || 1])),
  );
  for (const c of campaigns) {
    const cents = split[c.id]!;
    if (cents === c.budgetCents) continue;
    if (c.budgetGoogleId) {
      const r = await send(db, provider, { op: "set_budget", budget: c.budgetGoogleId, cents });
      if (!r.ok) continue;
    }
    await db.update(adCampaigns).set({ budgetCents: cents }).where(eq(adCampaigns.id, c.id));
  }
  return paced;
}
