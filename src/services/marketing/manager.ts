import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  adCampaigns,
  adDailyStats,
  adLandings,
  marketingActions,
  metaAdDaily,
  metaAdEntities,
  savedItems,
  type MetaAdEntity,
} from "@/db/schema";
import { googleShareCents } from "@/domain/ads/budget";
import { appliesItself } from "@/domain/ads/guardrails";
import { rigaDay } from "@/domain/analytics/visits";
import {
  adsToPause,
  planMetaBudgets,
  splitChannels,
  type ChannelId,
  type ChannelPerformance,
} from "@/domain/marketing/allocate";
import { dayOffset, getSettings, leadsByCampaign, paceBudgets, updateSettings } from "@/services/ads/account";
import type { AdsProvider } from "@/services/ads/provider";
import type { MetaAdsProvider } from "./meta-ads";

// The marketing manager's daily round (docs/GROWTH_PLAN.md, "One agent for every channel";
// owner, 24 Nov 2026): one daily budget for Google and Meta, spent where e-mails come from.
// Every morning before the Google optimiser it reads Meta's account, splits the day's total
// between the two channels by e-mails per euro, spreads Meta's share over what carries a budget
// there and pauses a Meta ad that had its chance. All by rules in code
// (domain/marketing/allocate.ts). In the owner's "manage" mode the steps are carried out;
// in any other mode they are written down as suggestions and nothing is changed.

const PAID_MEDIUM = "^(cpc|ppc|paid|paid_social|paidsocial|ads?|cpm)$";
const META_SOURCE = "^(facebook|fb|instagram|ig|meta|messenger|audience_network)$";

/**
 * E-mails left (saved products and price requests) by visitors a paid Meta ad brought, by
 * the campaign's and the ad's name as the ad's link carries them (utm_campaign={{campaign.name}},
 * utm_content={{ad.name}}; lower-case).
 */
export async function metaLeads(
  db: Db,
  from: string,
  to: string,
): Promise<{ campaign: string | null; ad: string | null; leads: number }[]> {
  const rows = await db
    .select({
      campaign: adLandings.utmCampaign,
      ad: adLandings.utmContent,
      n: sql<number>`count(*)::int`,
    })
    .from(savedItems)
    .innerJoin(adLandings, eq(adLandings.id, savedItems.adLandingId))
    .where(
      and(
        gte(adLandings.day, from),
        lte(adLandings.day, to),
        sql`${adLandings.utmSource} ~ ${META_SOURCE}`,
        sql`${adLandings.utmMedium} ~ ${PAID_MEDIUM}`,
      ),
    )
    .groupBy(adLandings.utmCampaign, adLandings.utmContent);
  return rows.map((r) => ({ campaign: r.campaign, ad: r.ad, leads: Number(r.n) }));
}

/**
 * The Meta campaigns (by lower-case name) whose ads can be judged one by one: Trilio saw paid
 * visits from the campaign in the period, and nearly every one named its ad. A campaign whose
 * links lack the tags, or carry a name the tags cannot hold, is never judged: its ads would
 * all look like they bring nothing.
 */
export async function trackedMetaCampaigns(db: Db, from: string, to: string): Promise<Set<string>> {
  const rows = await db
    .select({
      campaign: adLandings.utmCampaign,
      n: sql<number>`count(*)::int`,
      named: sql<number>`count(${adLandings.utmContent})::int`,
    })
    .from(adLandings)
    .where(
      and(
        gte(adLandings.day, from),
        lte(adLandings.day, to),
        sql`${adLandings.utmSource} ~ ${META_SOURCE}`,
        sql`${adLandings.utmMedium} ~ ${PAID_MEDIUM}`,
      ),
    )
    .groupBy(adLandings.utmCampaign);
  return new Set(
    rows
      .filter((r) => r.campaign && Number(r.n) >= 5 && Number(r.named) >= Number(r.n) * 0.9)
      .map((r) => r.campaign!),
  );
}

/** Reads Meta's account into Trilio's tables: what exists now, and the numbers per ad and day. */
export async function pullMeta(
  db: Db,
  meta: MetaAdsProvider,
  now = new Date(),
): Promise<{ ok: true; entities: number; days: number } | { ok: false; error: string }> {
  const listed = await meta.list();
  if (!listed.ok) return listed;
  const seenAt = now;
  for (const e of listed.entities)
    await db
      .insert(metaAdEntities)
      .values({ ...e, seenAt })
      .onConflictDoUpdate({ target: metaAdEntities.id, set: { ...e, seenAt } });
  // What Meta no longer lists (deleted or archived) is forgotten.
  await db.delete(metaAdEntities).where(sql`${metaAdEntities.seenAt} < ${seenAt.toISOString()}`);
  const numbers = await meta.insights(dayOffset(now, 28), dayOffset(now, 0));
  if (!numbers.ok) return numbers;
  for (const r of numbers.rows)
    await db
      .insert(metaAdDaily)
      .values(r)
      .onConflictDoUpdate({
        target: [metaAdDaily.day, metaAdDaily.adId],
        set: { spendCents: r.spendCents, impressions: r.impressions, linkClicks: r.linkClicks },
      });
  return { ok: true, entities: listed.entities.length, days: numbers.rows.length };
}

const running = (e: Pick<MetaAdEntity, "effectiveStatus">) => e.effectiveStatus === "ACTIVE";

export type ChannelRow = ChannelPerformance & {
  /** Cost per e-mail over 28 days, in cents; null without an e-mail. */
  costPerLeadCents: number | null;
};

/** Both paid channels over the last 28 days, as the split reads them. */
export async function channelPerformance(db: Db, now = new Date()): Promise<Record<ChannelId, ChannelRow>> {
  const settings = await getSettings(db);
  const from = dayOffset(now, 28);
  const to = dayOffset(now, 0);
  const [google] = await db
    .select({ micros: sql<number>`coalesce(sum(${adDailyStats.costMicros}), 0)::bigint` })
    .from(adDailyStats)
    .where(and(eq(adDailyStats.level, "campaign"), gte(adDailyStats.day, from), lte(adDailyStats.day, to)));
  const googleLeads = [...(await leadsByCampaign(db, from, to)).values()].reduce((a, n) => a + n, 0);
  const [googleOn] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adCampaigns)
    .where(eq(adCampaigns.status, "enabled"));
  const [meta] = await db
    .select({ cents: sql<number>`coalesce(sum(${metaAdDaily.spendCents}), 0)::int` })
    .from(metaAdDaily)
    .where(and(gte(metaAdDaily.day, from), lte(metaAdDaily.day, to)));
  const metaLeadCount = (await metaLeads(db, from, to)).reduce((a, r) => a + r.leads, 0);
  const entities = await db.select().from(metaAdEntities);
  // Meta can run when a budget is switched on somewhere: a campaign or an ad set that is not paused.
  const metaOn = entities.some(
    (e) => e.level !== "ad" && e.dailyBudgetCents !== null && e.status === "ACTIVE",
  );
  const row = (id: ChannelId, active: boolean, currentCents: number, spendCents: number, leads: number) => ({
    id,
    active,
    currentCents,
    spendCents,
    leads,
    costPerLeadCents: leads > 0 ? Math.round(spendCents / leads) : null,
  });
  return {
    google: row(
      "google",
      Number(googleOn?.n ?? 0) > 0,
      googleShareCents(settings),
      Math.round(Number(google?.micros ?? 0) / 10_000),
      googleLeads,
    ),
    meta: row(
      "meta",
      metaOn,
      settings.metaManaged ? settings.metaDailyCents : 0,
      Number(meta?.cents ?? 0),
      metaLeadCount,
    ),
  };
}

export type MarketingRun = {
  ok: boolean;
  error?: string;
  /** The steps were carried out ("manage" mode), or only written down. */
  applied: boolean;
  split: Record<ChannelId, number> | null;
  budgets: number;
  paused: number;
};

/**
 * One round, once a day (again with `force`). Without a Meta account there is nothing to
 * split: Google keeps the whole budget, as before.
 */
export async function runMarketingDaily(
  db: Db,
  deps: { meta: MetaAdsProvider | null; google: AdsProvider | null; now?: Date; force?: boolean },
): Promise<MarketingRun | null> {
  const now = deps.now ?? new Date();
  const day = rigaDay(now);
  const settings = await getSettings(db);
  if (!deps.meta || !settings.metaManaged) return null;
  const [done] = await db
    .select({ id: marketingActions.id })
    .from(marketingActions)
    .where(and(eq(marketingActions.day, day), eq(marketingActions.kind, "split")))
    .limit(1);
  if (done && !deps.force) return null;
  if (deps.force) await db.delete(marketingActions).where(eq(marketingActions.day, day));

  const note = (values: Omit<typeof marketingActions.$inferInsert, "day">) =>
    db.insert(marketingActions).values({ ...values, day });
  const pulled = await pullMeta(db, deps.meta, now);
  if (!pulled.ok) {
    await note({ kind: "split", detail: {}, reason: "Meta kontu neizdevās nolasīt.", error: pulled.error });
    return { ok: false, error: pulled.error, applied: false, split: null, budgets: 0, paused: 0 };
  }
  const act = appliesItself({ ...settings, autoActions: [] }, "marketing");
  const perf = await channelPerformance(db, now);
  const total = settings.dailyBudgetCents;
  const split = splitChannels(total, [perf.google, perf.meta]);
  const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  await note({
    kind: "split",
    detail: {
      totalCents: total,
      googleCents: split.google,
      metaCents: split.meta,
      google: { spendCents: perf.google.spendCents, leads: perf.google.leads, active: perf.google.active },
      meta: { spendCents: perf.meta.spendCents, leads: perf.meta.leads, active: perf.meta.active },
    },
    reason: `Google ${eur(split.google)} €, Meta ${eur(split.meta)} €. 28 dienās Google: ${eur(perf.google.spendCents)} € un ${perf.google.leads} e-pasti; Meta: ${eur(perf.meta.spendCents)} € un ${perf.meta.leads} e-pasti.`,
    applied: act,
  });
  if (!act) return { ok: true, applied: false, split, budgets: 0, paused: 0 };

  if (split.meta !== settings.metaDailyCents) {
    await updateSettings(db, { metaDailyCents: split.meta });
    // Google's campaigns take their new total now, not at the next pacing.
    if (deps.google) await paceBudgets(db, deps.google, now).catch(() => undefined);
  }

  // Meta's share over what carries a budget there.
  const from28 = dayOffset(now, 28);
  const today = dayOffset(now, 0);
  const entities = await db.select().from(metaAdEntities);
  const leads28 = await metaLeads(db, from28, today);
  const spendByCampaign = new Map(
    (
      await db
        .select({ id: metaAdDaily.campaignId, cents: sql<number>`sum(${metaAdDaily.spendCents})::int` })
        .from(metaAdDaily)
        .where(and(gte(metaAdDaily.day, from28), lte(metaAdDaily.day, today)))
        .groupBy(metaAdDaily.campaignId)
    ).map((r) => [r.id, Number(r.cents)]),
  );
  const campaignName = new Map(entities.filter((e) => e.level === "campaign").map((e) => [e.id, e.name]));
  const leadsOfCampaign = (id: string) => {
    const name = campaignName.get(id)?.toLowerCase();
    return leads28.filter((l) => name && l.campaign === name).reduce((a, l) => a + l.leads, 0);
  };
  const holders = entities
    .filter((e) => e.level !== "ad" && e.dailyBudgetCents !== null && e.status === "ACTIVE")
    .map((e) => {
      const campaign = e.level === "campaign" ? e.id : (e.campaignId ?? "");
      return {
        id: e.id,
        dailyBudgetCents: e.dailyBudgetCents!,
        spendCents: spendByCampaign.get(campaign) ?? 0,
        leads: leadsOfCampaign(campaign),
      };
    });
  const plan = planMetaBudgets(split.meta, holders);
  let budgets = 0;
  let paused = 0;
  for (const h of holders) {
    const cents = plan.budgets[h.id];
    if (cents === undefined || cents === h.dailyBudgetCents) continue;
    const r = await deps.meta.setDailyBudget(h.id, cents);
    await note({
      kind: "meta_budget",
      entityId: h.id,
      detail: { fromCents: h.dailyBudgetCents, toCents: cents },
      reason: `Meta dienas budžets ${eur(h.dailyBudgetCents)} € → ${eur(cents)} €.`,
      applied: r.ok,
      error: r.ok ? null : r.error,
    });
    if (r.ok) {
      budgets++;
      await db.update(metaAdEntities).set({ dailyBudgetCents: cents }).where(eq(metaAdEntities.id, h.id));
    }
  }
  const pause = async (id: string, reason: string) => {
    const r = await deps.meta!.setStatus(id, "PAUSED");
    await note({
      kind: "meta_pause",
      entityId: id,
      detail: {},
      reason,
      applied: r.ok,
      error: r.ok ? null : r.error,
    });
    if (r.ok) {
      paused++;
      await db
        .update(metaAdEntities)
        .set({ status: "PAUSED", effectiveStatus: "PAUSED" })
        .where(eq(metaAdEntities.id, id));
    }
  };
  for (const id of plan.pause)
    await pause(id, `Meta daļa ${eur(split.meta)} € nepietiek visiem: katram vajag vismaz 1 € dienā.`);

  // An ad that spent 5 € in 14 days without an e-mail, where another ad of its ad set runs.
  const from14 = dayOffset(now, 14);
  const spend14 = new Map(
    (
      await db
        .select({ id: metaAdDaily.adId, cents: sql<number>`sum(${metaAdDaily.spendCents})::int` })
        .from(metaAdDaily)
        .where(and(gte(metaAdDaily.day, from14), lte(metaAdDaily.day, today)))
        .groupBy(metaAdDaily.adId)
    ).map((r) => [r.id, Number(r.cents)]),
  );
  const leads14 = await metaLeads(db, from14, today);
  const tracked = await trackedMetaCampaigns(db, from14, today);
  const ads = (await db.select().from(metaAdEntities).where(eq(metaAdEntities.level, "ad"))).map((a) => {
    const judged = tracked.has(campaignName.get(a.campaignId ?? "")?.toLowerCase() ?? "");
    return {
      id: a.id,
      adsetId: a.adsetId ?? a.campaignId ?? a.id,
      active: running(a),
      spendCents: spend14.get(a.id) ?? 0,
      // An ad of a campaign that cannot be judged counts as one that works: it is never paused.
      leads: judged
        ? leads14.filter((l) => l.ad === a.name.toLowerCase()).reduce((n, l) => n + l.leads, 0)
        : 1,
    };
  });
  for (const id of adsToPause(ads)) {
    const ad = ads.find((a) => a.id === id)!;
    await pause(id, `Reklāma 14 dienās iztērēja ${eur(ad.spendCents)} € un neatnesa nevienu e-pastu.`);
  }
  return { ok: true, applied: true, split, budgets, paused };
}

/** The last steps, newest first, for the admin page. */
export async function recentMarketingActions(db: Db, limit = 40) {
  return db.select().from(marketingActions).orderBy(desc(marketingActions.createdAt)).limit(limit);
}
