import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  adLandings,
  affiliateClicks,
  seoQueries,
  tvCampaigns,
  tvDaily,
  tvImpressions,
  tvUplift,
  tvViewers,
  visits,
  type TvBaseline,
} from "@/db/schema";
import { RAW_RETENTION_DAYS, rigaDay } from "@/domain/analytics/visits";
import { SLUG, slugify, viewerHash, viewerId } from "@/domain/growth/tv";
import {
  BASELINE_DAYS,
  baselineProfile,
  dayUplift,
  perBucket,
  rigaDayStart,
  sessionsOf,
  summarise,
  type DayUplift,
  type UpliftSummary,
} from "@/domain/growth/uplift";

// Addressable TV campaigns measured by Trilio's own tracker (docs/GROWTH_PLAN.md, TV).
// Impressions and reach come from the pixel Go3's ad server calls; site visits
// and shop clicks come from the short link, through the same cookieless ad
// attribution as Google Ads (utm_medium=tv).

export const TV_VIEWER_RETENTION_DAYS = 90;

export type TvCampaign = typeof tvCampaigns.$inferSelect;

export async function createTvCampaign(
  db: Db,
  input: { name: string; slug?: string; landingPath?: string },
): Promise<{ ok: true; slug: string } | { ok: false; error: "slug" | "taken" | "landing" }> {
  const slug = (input.slug?.trim() || slugify(input.name)).toLowerCase();
  if (!SLUG.test(slug)) return { ok: false, error: "slug" };
  const landingPath = input.landingPath?.trim() || "/";
  if (!/^\/[^\s]*$/.test(landingPath) || landingPath.startsWith("//")) return { ok: false, error: "landing" };
  const [row] = await db
    .insert(tvCampaigns)
    .values({
      slug,
      name: input.name.trim().slice(0, 120) || slug,
      landingPath,
      salt: randomBytes(24).toString("base64url"),
    })
    .onConflictDoNothing()
    .returning({ slug: tvCampaigns.slug });
  return row ? { ok: true, slug } : { ok: false, error: "taken" };
}

export async function getTvCampaign(db: Db, slug: string): Promise<TvCampaign | null> {
  if (!SLUG.test(slug)) return null;
  const [row] = await db.select().from(tvCampaigns).where(eq(tvCampaigns.slug, slug));
  return row ?? null;
}

export async function deleteTvCampaign(db: Db, slug: string): Promise<void> {
  await db.delete(tvCampaigns).where(eq(tvCampaigns.slug, slug));
}

async function bump(db: Db, slug: string, day: string, kind: "impression" | "link") {
  await db
    .insert(tvDaily)
    .values({ slug, day, kind, hits: 1 })
    .onConflictDoUpdate({
      target: [tvDaily.slug, tvDaily.day, tvDaily.kind],
      set: { hits: sql`${tvDaily.hits} + 1` },
    });
}

/**
 * One impression from the tracker: counted per day, and the viewer (device id,
 * or forwarded IP and user agent) kept only as a salted hash for reach.
 * Unknown campaigns are not counted. Returns whether it was counted.
 */
export async function recordTvImpression(
  db: Db,
  input: { slug: string; vid: string | null; ip: string | null; userAgent: string | null; now?: Date },
): Promise<boolean> {
  const campaign = await getTvCampaign(db, input.slug);
  if (!campaign) return false;
  const now = input.now ?? new Date();
  const day = rigaDay(now);
  await bump(db, campaign.slug, day, "impression");
  // Per minute too, for the 24-hour profile and the uplift (docs/TV_ANALYTICS_PLAN.md).
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  await db
    .insert(tvImpressions)
    .values({ slug: campaign.slug, minute, hits: 1 })
    .onConflictDoUpdate({
      target: [tvImpressions.slug, tvImpressions.minute],
      set: { hits: sql`${tvImpressions.hits} + 1` },
    });
  const hash = viewerHash(campaign.salt, {
    vid: viewerId(input.vid),
    ip: input.ip,
    userAgent: input.userAgent,
  });
  if (hash)
    await db.insert(tvViewers).values({ slug: campaign.slug, day, viewerHash: hash }).onConflictDoNothing();
  return true;
}

/** One opening of the short link (a person typing it or scanning the QR code). */
export async function recordTvLinkOpen(db: Db, slug: string, now = new Date()): Promise<void> {
  await bump(db, slug, rigaDay(now), "link");
}

export type TvStats = {
  campaign: TvCampaign;
  impressions: number;
  /** Unique devices over the whole campaign. */
  reach: number;
  linkOpens: number;
  /** Visits that arrived through the short link (utm_medium=tv). */
  visits: number;
  /** Shop clicks by those visitors the same day. */
  shopClicks: number;
  days: { day: string; impressions: number; reach: number; linkOpens: number }[];
};

export async function tvStats(db: Db): Promise<TvStats[]> {
  const campaigns = await db.select().from(tvCampaigns).orderBy(desc(tvCampaigns.createdAt));
  return Promise.all(
    campaigns.map(async (campaign) => {
      const daily = await db
        .select({ day: tvDaily.day, kind: tvDaily.kind, hits: tvDaily.hits })
        .from(tvDaily)
        .where(eq(tvDaily.slug, campaign.slug));
      const reachPerDay = await db
        .select({ day: tvViewers.day, n: sql<number>`count(*)::int` })
        .from(tvViewers)
        .where(eq(tvViewers.slug, campaign.slug))
        .groupBy(tvViewers.day);
      const [reach] = await db
        .select({ n: sql<number>`count(distinct ${tvViewers.viewerHash})::int` })
        .from(tvViewers)
        .where(eq(tvViewers.slug, campaign.slug));
      const fromTv = and(eq(adLandings.utmMedium, "tv"), eq(adLandings.utmCampaign, campaign.slug));
      const [visits] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(adLandings)
        .where(fromTv);
      const [clicks] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(affiliateClicks)
        .innerJoin(adLandings, eq(adLandings.id, affiliateClicks.adLandingId))
        .where(fromTv);
      const days = new Map<string, { day: string; impressions: number; reach: number; linkOpens: number }>();
      const at = (day: string) => {
        if (!days.has(day)) days.set(day, { day, impressions: 0, reach: 0, linkOpens: 0 });
        return days.get(day)!;
      };
      for (const d of daily) {
        if (d.kind === "impression") at(d.day).impressions = d.hits;
        if (d.kind === "link") at(d.day).linkOpens = d.hits;
      }
      for (const r of reachPerDay) at(r.day).reach = Number(r.n);
      const list = [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
      return {
        campaign,
        impressions: list.reduce((n, d) => n + d.impressions, 0),
        reach: Number(reach?.n ?? 0),
        linkOpens: list.reduce((n, d) => n + d.linkOpens, 0),
        visits: Number(visits?.n ?? 0),
        shopClicks: Number(clicks?.n ?? 0),
        days: list,
      };
    }),
  );
}

/** Viewer hashes older than 90 days are deleted (the daily counts stay). */
export async function purgeTvViewers(db: Db, now = new Date()): Promise<number> {
  const cutoff = rigaDay(new Date(now.getTime() - TV_VIEWER_RETENTION_DAYS * 86_400_000));
  const rows = await db.delete(tvViewers).where(lt(tvViewers.day, cutoff)).returning({ day: tvViewers.day });
  return rows.length;
}

/* ---------- the uplift (docs/TV_ANALYTICS_PLAN.md) ---------- */

const DAY_MS = 86_400_000;
const shiftDay = (day: string, days: number) =>
  rigaDay(new Date(rigaDayStart(day).getTime() + days * DAY_MS + DAY_MS / 2));

/** A day's page views as the uplift needs them (raw visits: the last 35 days). */
async function pageViews(db: Db, day: string) {
  const rows = await db
    .select({
      visitorHash: visits.visitorHash,
      at: visits.createdAt,
      section: visits.section,
      client: visits.client,
    })
    .from(visits)
    .where(eq(visits.day, day));
  return rows;
}

/** The first day the pixel counted an impression, or null. */
export async function firstImpressionDay(db: Db, slug: string): Promise<string | null> {
  const [row] = await db
    .select({ day: sql<string>`min(${tvDaily.day})::text` })
    .from(tvDaily)
    .where(and(eq(tvDaily.slug, slug), eq(tvDaily.kind, "impression")));
  return row?.day ?? null;
}

/**
 * Sets the campaign's baseline once: sessions per bucket averaged over the
 * BASELINE_DAYS days before its first impression, from the raw visits still
 * kept. Days without a single page view are left out. Returns the baseline.
 */
export async function ensureTvBaseline(db: Db, campaign: TvCampaign): Promise<TvBaseline | null> {
  if (campaign.baseline) return campaign.baseline;
  const first = await firstImpressionDay(db, campaign.slug);
  if (!first) return null;
  const to = shiftDay(first, -1);
  const from = shiftDay(first, -BASELINE_DAYS);
  const days: number[][] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    const views = await pageViews(db, day);
    if (views.length === 0) continue;
    days.push(perBucket(sessionsOf(views)));
  }
  const baseline: TvBaseline = { from, to, days: days.length, sessions: baselineProfile(days) };
  await db.update(tvCampaigns).set({ baseline }).where(eq(tvCampaigns.slug, campaign.slug));
  return baseline;
}

/** The baseline's bucket series when it rests on at least one day; otherwise null (no uplift figure). */
const usable = (b: TvBaseline | null | undefined) => (b && b.days > 0 ? b.sessions : null);

/** One day's uplift computed from the raw data (today, or a day the rollup has not stored yet). */
export async function computeTvUpliftDay(db: Db, campaign: TvCampaign, day: string): Promise<DayUplift> {
  const start = rigaDayStart(day);
  const end = new Date(start.getTime() + DAY_MS);
  const impressions = await db
    .select({ minute: tvImpressions.minute, hits: tvImpressions.hits })
    .from(tvImpressions)
    .where(
      and(
        eq(tvImpressions.slug, campaign.slug),
        gte(tvImpressions.minute, start),
        lt(tvImpressions.minute, end),
      ),
    );
  const clicks = await db
    .select({ at: affiliateClicks.clickedAt })
    .from(affiliateClicks)
    .where(
      and(
        gte(affiliateClicks.clickedAt, start),
        lt(affiliateClicks.clickedAt, end),
        eq(affiliateClicks.internal, false),
      ),
    );
  return dayUplift({
    impressions: perBucket(impressions.map((i) => ({ at: i.minute, n: i.hits }))),
    sessions: sessionsOf(await pageViews(db, day)),
    clicks: clicks.map((c) => c.at),
    baseline: usable(campaign.baseline),
  });
}

/** Days with impressions between two Riga days, inclusive. */
async function impressionDays(db: Db, slug: string, from: string, to: string): Promise<string[]> {
  const rows = await db
    .select({ day: sql<string>`${tvDaily.day}::text` })
    .from(tvDaily)
    .where(
      and(
        eq(tvDaily.slug, slug),
        eq(tvDaily.kind, "impression"),
        gte(tvDaily.day, from),
        lte(tvDaily.day, to),
      ),
    )
    .orderBy(asc(tvDaily.day));
  return rows.map((r) => r.day);
}

/**
 * Nightly: sets baselines, then stores the uplift for finished days with
 * impressions whose raw visits are still kept. The last two stored days are
 * recomputed, for pixel calls and clicks that arrived late. Idempotent.
 * Returns how many day rows were written.
 */
export async function rollupTvUplift(db: Db, now = new Date()): Promise<number> {
  const today = rigaDay(now);
  const cutoff = rigaDay(new Date(now.getTime() - (RAW_RETENTION_DAYS - 1) * DAY_MS));
  const campaigns = await db.select().from(tvCampaigns);
  let written = 0;
  for (const c of campaigns) {
    const baseline = await ensureTvBaseline(db, c);
    const campaign = { ...c, baseline };
    const days = await impressionDays(db, c.slug, cutoff, shiftDay(today, -1));
    if (days.length === 0) continue;
    const stored = await db
      .select({ day: sql<string>`${tvUplift.day}::text` })
      .from(tvUplift)
      .where(and(eq(tvUplift.slug, c.slug), inArray(tvUplift.day, days)));
    const have = new Set(stored.map((r) => r.day));
    const redo = new Set(days.slice(-2));
    for (const day of days) {
      if (have.has(day) && !redo.has(day)) continue;
      const u = await computeTvUpliftDay(db, campaign, day);
      await db
        .insert(tvUplift)
        .values({ slug: c.slug, day, ...u, computedAt: now })
        .onConflictDoUpdate({ target: [tvUplift.slug, tvUplift.day], set: { ...u, computedAt: now } });
      written++;
    }
  }
  return written;
}

export type TvReport = {
  campaign: TvCampaign;
  /** The campaign's days with impressions, newest first, each with its uplift figures. */
  days: ({ day: string; live: boolean } & DayUplift)[];
  summary: UpliftSummary;
  baseline: TvBaseline | null;
  /** Searches containing "trilio" per day (Search Console), from the baseline's first day on. */
  brand: { day: string; clicks: number; impressions: number }[];
};

/** Stored days plus today's live figures, summarised (docs/TV_ANALYTICS_PLAN.md §3). */
export async function tvReport(db: Db, slug: string, now = new Date()): Promise<TvReport | null> {
  const campaign = await getTvCampaign(db, slug);
  if (!campaign) return null;
  const today = rigaDay(now);
  const first = await firstImpressionDay(db, slug);
  const stored = await db.select().from(tvUplift).where(eq(tvUplift.slug, slug));
  const have = new Map(stored.map((r) => [String(r.day), r]));
  const days: TvReport["days"] = [];
  if (first) {
    const cutoff = rigaDay(new Date(now.getTime() - (RAW_RETENTION_DAYS - 1) * DAY_MS));
    for (const day of await impressionDays(db, slug, first, today)) {
      const row = have.get(day);
      if (row && day !== today) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the key columns are not figures
        const { slug: _slug, day: _day, computedAt: _at, ...figures } = row;
        days.push({ day, live: false, ...figures });
      } else if (day >= cutoff) {
        days.push({ day, live: true, ...(await computeTvUpliftDay(db, campaign, day)) });
      }
    }
  }
  days.sort((a, b) => b.day.localeCompare(a.day));
  const base = usable(campaign.baseline);
  const brandFrom = campaign.baseline?.from ?? (first ? shiftDay(first, -BASELINE_DAYS) : today);
  const brand = await db
    .select({
      day: sql<string>`${seoQueries.day}::text`,
      clicks: sql<number>`sum(${seoQueries.clicks})::int`,
      impressions: sql<number>`sum(${seoQueries.impressions})::int`,
    })
    .from(seoQueries)
    .where(and(gte(seoQueries.day, brandFrom), sql`${seoQueries.query} ilike '%trilio%'`))
    .groupBy(seoQueries.day)
    .orderBy(asc(seoQueries.day));
  return {
    campaign,
    days,
    summary: summarise([...days].reverse(), base),
    baseline: campaign.baseline ?? null,
    brand: brand.map((b) => ({ day: b.day, clicks: Number(b.clicks), impressions: Number(b.impressions) })),
  };
}
