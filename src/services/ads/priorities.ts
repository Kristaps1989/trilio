import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { adCampaigns, adDailyStats } from "@/db/schema";
import { rigaDay } from "@/domain/analytics/visits";
import { recommend, type CampaignFacts, type Recommendation } from "@/domain/ads/priority";
import { BRAND_GROUP, COMPETITOR_GROUP } from "@/domain/ads/plan";
import { trilioSources } from "@/domain/offers/sourcing";
import { catalog } from "@/domain/questions/catalog";
import { cleanVisitor } from "@/services/visits/suspects";
import { conversionsByDay, dayOffset, getSettings, setCampaignBudget, setCampaignsStatus } from "./account";
import type { AdsProvider } from "./provider";

// Reklāma → Kampaņas: which campaigns to switch on first (src/domain/ads/priority.ts), from
// Google's figures, what ad visitors did on Trilio, and what people search for on the site.

export type Priorities = {
  dailyBudgetCents: number;
  conversions30d: number;
  recommendations: Recommendation[];
};

export async function campaignPriorities(db: Db, now = new Date()): Promise<Priorities> {
  const settings = await getSettings(db);
  const campaigns = await db.select().from(adCampaigns).orderBy(adCampaigns.name);
  const d28 = dayOffset(now, 28);
  const stats = await db
    .select({
      id: adDailyStats.entityId,
      clicks: sql<number>`sum(${adDailyStats.clicks})::int`,
      micros: sql<number>`sum(${adDailyStats.costMicros})::bigint`,
    })
    .from(adDailyStats)
    .where(and(eq(adDailyStats.level, "campaign"), gte(adDailyStats.day, d28)))
    .groupBy(adDailyStats.entityId);
  const byId = new Map(stats.map((s) => [s.id, s]));
  // What ad visitors did, by the campaign id Google's final URL suffix carries (utm_campaign).
  const own = await conversionsByDay(db, dayOffset(now, 30), rigaDay(now));
  const outcomes = new Map<string, number>();
  let conversions30d = 0;
  for (const r of own) {
    const n = r.shopClicks + r.saves;
    conversions30d += n;
    if (r.campaign) outcomes.set(r.campaign, (outcomes.get(r.campaign) ?? 0) + n);
  }
  // People's own searches on the site in the last 30 days, per subcategory.
  const searched = (await db.execute(sql`
    select subcategory_id as sub, count(*)::int as n
      from search_sessions ss
     where ss.created_at >= now() - interval '30 days' and ss.suspect is null
       and (ss.visitor_hash is null or ${cleanVisitor(
         sql`(ss.created_at at time zone 'Europe/Riga')::date`,
         sql`ss.visitor_hash`,
       )})
     group by 1`)) as unknown as { sub: string; n: number }[];
  const bySub = new Map(searched.map((r) => [r.sub, Number(r.n)]));
  const facts: CampaignFacts[] = campaigns
    .filter((c) => c.status !== "removed")
    .map((c) => {
      const group = catalog.groups.find((g) => g.id === c.groupId);
      const subs = group?.subcategories ?? [];
      const tag = c.googleId?.split("/").pop() ?? null;
      const special = c.groupId === BRAND_GROUP || c.groupId === COMPETITOR_GROUP;
      return {
        id: c.id,
        name: c.name,
        kind: c.kind,
        groupId: c.groupId,
        status: c.status,
        adClicks: Number(byId.get(c.id)?.clicks ?? 0),
        costCents: Math.round(Number(byId.get(c.id)?.micros ?? 0) / 10_000),
        outcomes: tag ? (outcomes.get(tag) ?? 0) : 0,
        siteSearches: special ? 0 : subs.reduce((n, s) => n + (bySub.get(s.id) ?? 0), 0),
        sourced: subs.some((s) => trilioSources(s.id)),
      };
    });
  return {
    dailyBudgetCents: settings.dailyBudgetCents,
    conversions30d,
    recommendations: recommend(facts, { dailyBudgetCents: settings.dailyBudgetCents, conversions30d }),
  };
}

/**
 * Does what the recommendation says for the campaigns to switch on now (all of them, or one):
 * sets the suggested daily budget, then enables the campaign. A campaign not yet in Google is
 * skipped; it has to be sent there first.
 */
export async function applyRecommendation(
  db: Db,
  provider: AdsProvider,
  campaignId?: string,
): Promise<{ enabled: number; skipped: number }> {
  const { recommendations } = await campaignPriorities(db);
  const targets = recommendations.filter(
    (r) => r.tier === "now" && (campaignId ? r.id === campaignId : true),
  );
  let enabled = 0;
  let skipped = 0;
  for (const r of targets) {
    if (r.budgetCents !== null) {
      const b = await setCampaignBudget(db, provider, r.id, r.budgetCents);
      if (!b.ok) {
        skipped++;
        continue;
      }
    }
    const n = r.facts.status === "enabled" ? 1 : await setCampaignsStatus(db, provider, "enabled", r.id);
    if (n) enabled++;
    else skipped++;
  }
  return { enabled, skipped };
}
