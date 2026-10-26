import { randomBytes } from "node:crypto";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { adLandings, affiliateClicks, tvCampaigns, tvDaily, tvViewers } from "@/db/schema";
import { rigaDay } from "@/domain/analytics/visits";
import { SLUG, slugify, viewerHash, viewerId } from "@/domain/growth/tv";

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
  const day = rigaDay(input.now ?? new Date());
  await bump(db, campaign.slug, day, "impression");
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
