import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  adLandings,
  affiliateClicks,
  seoQueries,
  tvCampaigns,
  tvDaily,
  tvExposures,
  tvHouseholdVisits,
  tvImpressions,
  tvPixelAddresses,
  tvPixelCounts,
  tvUplift,
  tvViewers,
  visits,
  type TvBaseline,
  type TvHouseholdFigures,
} from "@/db/schema";
import { isBot, RAW_RETENTION_DAYS, rigaDay } from "@/domain/analytics/visits";
import { cleanVisitor } from "@/services/visits/suspects";
import {
  CHANNELS,
  mixOf,
  TV_ELIGIBLE,
  visitorChannel,
  type Channel,
  type ChannelMix,
} from "@/domain/growth/channels";

/** The visitor filter the baseline and the uplift use now (docs/TV_ANALYTICS_PLAN.md §8). */
export const CHANNEL_FILTER = "tv-eligible-v1";
import {
  accountHash,
  advertisingId,
  deviceHash,
  parseGo3Viewer,
  SLUG,
  slugify,
  SOURCE,
  viewerHash,
  viewerId,
} from "@/domain/growth/tv";
import { deviceLabel, parseSection } from "@/domain/growth/go3-section";
import {
  addressHash,
  DIAGNOSTIC_HEADERS,
  holdoutLift,
  householdFigures,
  usableSource,
  type AddressSource,
  eventTime,
  forwardedChain,
  householdAddress,
  householdHash,
  householdKey,
  tvClientFamily,
  type PixelParams,
} from "@/domain/growth/tv-pixel";
import {
  afterTv,
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
  input: { name: string; slug?: string; landingPath?: string; kind?: string; source?: string },
): Promise<{ ok: true; slug: string } | { ok: false; error: "slug" | "taken" | "landing" | "source" }> {
  const slug = (input.slug?.trim() || slugify(input.name)).toLowerCase();
  if (!SLUG.test(slug)) return { ok: false, error: "slug" };
  const landingPath = input.landingPath?.trim() || "/";
  if (!/^\/[^\s]*$/.test(landingPath) || landingPath.startsWith("//")) return { ok: false, error: "landing" };
  const kind = input.kind === "display" ? "display" : "tv";
  const source = input.source?.trim().toLowerCase() || null;
  if (source && !SOURCE.test(source)) return { ok: false, error: "source" };
  const [row] = await db
    .insert(tvCampaigns)
    .values({
      slug,
      name: input.name.trim().slice(0, 120) || slug,
      landingPath,
      salt: randomBytes(24).toString("base64url"),
      kind,
      source: kind === "display" ? source : null,
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
  // Its flight ends with it: the partner goes back to its own salt.
  await unlinkFlight(db, slug);
  await db.delete(tvCampaigns).where(eq(tvCampaigns.slug, slug));
  activeCache = null;
}

async function bump(db: Db, slug: string, day: string, kind: "impression" | "link" | "control") {
  await db
    .insert(tvDaily)
    .values({ slug, day, kind, hits: 1 })
    .onConflictDoUpdate({
      target: [tvDaily.slug, tvDaily.day, tvDaily.kind],
      set: { hits: sql`${tvDaily.hits} + 1` },
    });
}

/** The pixel request's own parameters and the headers the diagnostic reads (docs/TV_PIXEL_BEST_PRACTICE.md). */
export type PixelRequest = {
  params: PixelParams;
  /** Lower-case header name → value, for DIAGNOSTIC_HEADERS only. */
  headers: Partial<Record<(typeof DIAGNOSTIC_HEADERS)[number], string | null>>;
};

/**
 * One impression from the tracker: counted per day and minute, the viewer
 * (device id, or forwarded IP and user agent) kept only as a salted hash for
 * reach and frequency. With `pixel`: a holdout impression (`grp=control`) is
 * counted apart and never as an impression; the ad event's own time (`ts`) is
 * used when plausible; what the request carried is counted for the diagnostic
 * (headers present, forwarding hops, creative, channel, position, device
 * families, distinct addresses as day-keyed hashes); and the household's
 * address, when one arrives, is kept as a salted hash per minute for the
 * household view-through. Unknown campaigns are not counted. Returns whether it was counted.
 */
export async function recordTvImpression(
  db: Db,
  input: {
    slug: string;
    vid: string | null;
    ip: string | null;
    userAgent: string | null;
    now?: Date;
    pixel?: PixelRequest;
  },
): Promise<boolean> {
  const campaign = await getTvCampaign(db, input.slug);
  if (!campaign) return false;
  // A banner's tracker is called by browsers: crawlers and link previews that load the page
  // are not people who saw it. (A TV tracker is called by the ad server, never filtered.)
  if (campaign.kind === "display" && isBot(input.userAgent)) return true;
  // The ad server's own preview of the creative is not an impression.
  if (input.pixel?.params.preview) return true;
  const received = input.now ?? new Date();
  const p = input.pixel?.params;
  const now = eventTime(p?.ts ?? null, received) ?? received;
  const day = rigaDay(now);
  const control = p?.grp === "control";
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  await bump(db, campaign.slug, day, control ? "control" : "impression");
  if (!control) {
    // Per minute too, for the 24-hour profile and the uplift (docs/TV_ANALYTICS_PLAN.md).
    await db
      .insert(tvImpressions)
      .values({ slug: campaign.slug, minute, hits: 1 })
      .onConflictDoUpdate({
        target: [tvImpressions.slug, tvImpressions.minute],
        set: { hits: sql`${tvImpressions.hits} + 1` },
      });
    // A device that opted out of ad tracking is counted, never followed: no viewer hash.
    const hash = p?.optOut
      ? null
      : viewerHash(campaign.salt, {
          vid: viewerId(input.vid),
          ip: input.ip,
          userAgent: input.userAgent,
        });
    const go3 = p?.optOut ? null : parseGo3Viewer(viewerId(input.vid));
    // In a flight, the device's advertising id under the shared salt: the same phone in the
    // TV app and in a banner's app is one hash. Never for an opted-out device.
    const adId = p?.optOut ? null : (advertisingId(p?.did) ?? advertisingId(viewerId(input.vid)));
    const device = campaign.flightSalt && adId ? deviceHash(campaign.flightSalt, adId) : null;
    if (hash)
      await db
        .insert(tvViewers)
        .values({
          slug: campaign.slug,
          day,
          viewerHash: hash,
          impressions: 1,
          accountHash: go3 ? accountHash(campaign.salt, go3.account) : null,
          child: go3 ? go3.child : null,
          deviceHash: device,
        })
        .onConflictDoUpdate({
          target: [tvViewers.slug, tvViewers.day, tvViewers.viewerHash],
          set: {
            impressions: sql`${tvViewers.impressions} + 1`,
            deviceHash: sql`coalesce(excluded.device_hash, ${tvViewers.deviceHash})`,
          },
        });
  }
  if (input.pixel) await recordPixelDetail(db, campaign, day, minute, input, input.pixel, received);
  // A campaign that just started running is read again at the next page view, not 5 minutes later.
  if (activeCache && !activeCache.list.some((c) => c.slug === campaign.slug)) activeCache = null;
  return true;
}

/** The diagnostic counters, distinct address hashes and the household exposure of one pixel request. */
async function recordPixelDetail(
  db: Db,
  campaign: TvCampaign,
  day: string,
  minute: Date,
  input: { vid: string | null; userAgent: string | null; ip?: string | null },
  pixel: PixelRequest,
  received: Date,
) {
  const display = campaign.kind === "display";
  const { params: p, headers: h } = pixel;
  const chain = forwardedChain(h["x-forwarded-for"]);
  const keys = new Set<string>(["total", `grp:${p.grp}`, `xff:${Math.min(chain.length, 3)}`]);
  for (const name of DIAGNOSTIC_HEADERS) if (h[name]) keys.add(`hdr:${name}`);
  for (const [k, v] of Object.entries({
    vid: input.vid,
    ip: p.ip,
    ts: p.ts,
    cr: p.cr,
    ch: p.ch,
    pos: p.pos,
    csid: p.csid,
    dt: p.dt,
    ua: p.ua,
    co: p.country,
    dur: p.dur,
    pg: p.program,
    gn: p.genre,
    dp: p.daypart,
    pl: p.placement,
    idt: p.idType,
  }))
    if (v) keys.add(`param:${k}`);
  if (p.ts) keys.add(eventTime(p.ts, received) ? "ts:used" : "ts:off");
  if (p.cr) keys.add(`cr:${p.cr}`);
  if (p.ch) keys.add(`ch:${p.ch}`);
  if (p.pos) keys.add(`pos:${p.pos}`);
  if (p.csid) keys.add(`cs:${p.csid}`);
  if (p.country) keys.add(`co:${p.country}`);
  if (p.dur) keys.add(`du:${p.dur}`);
  if (p.program) keys.add(`pg:${p.program}`);
  if (p.genre) keys.add(`gn:${p.genre}`);
  if (p.daypart) keys.add(`dp:${p.daypart}`);
  if (p.placement) keys.add(`pl:${p.placement}`);
  if (p.idType) keys.add(`it:${p.idType}`);
  if (p.optOut) keys.add("lat:1");
  if (p.dt) keys.add(`dt:${p.dt}`);
  keys.add(`ua:${tvClientFamily(input.userAgent)}`);
  // The device's own user agent: the ?ua= macro, else a header the ad server added.
  const deviceUa = p.ua ?? h["x-device-user-agent"];
  if (deviceUa) keys.add(`dua:${tvClientFamily(deviceUa)}`);
  await db
    .insert(tvPixelCounts)
    .values([...keys].map((key) => ({ slug: campaign.slug, day, key: key.slice(0, 80), hits: 1 })))
    .onConflictDoUpdate({
      target: [tvPixelCounts.slug, tvPixelCounts.day, tvPixelCounts.key],
      set: { hits: sql`${tvPixelCounts.hits} + 1` },
    });
  const addresses: [string, string | null | undefined][] = [
    ["xff0", chain[0]],
    ["xffn", chain.length > 1 ? chain[chain.length - 1] : null],
    ["device", h["x-device-ip"]],
    ["macro", p.ip],
    // The browser's own address, for a banner (no ad server stands in between).
    ["client", display ? input.ip : null],
  ];
  // An opted-out device leaves no address hash and no household exposure.
  if (p.optOut) return;
  const rows = addresses
    .filter((a): a is [string, string] => !!a[1])
    .map(([source, address]) => ({
      slug: campaign.slug,
      day,
      source,
      addressHash: addressHash(campaign.salt, day, address.trim().toLowerCase()),
    }));
  if (rows.length) await db.insert(tvPixelAddresses).values(rows).onConflictDoNothing();
  const clientKeyOf = display ? householdKey(input.ip) : null;
  const household = clientKeyOf
    ? { key: clientKeyOf, source: "client" as const }
    : display
      ? null
      : householdAddress({
          macroIp: p.ip,
          deviceIp: h["x-device-ip"] ?? null,
          xff: h["x-forwarded-for"] ?? null,
        });
  if (household)
    await db
      .insert(tvExposures)
      .values({
        slug: campaign.slug,
        household: householdHash(householdSalt(campaign), household.key),
        minute,
        grp: p.grp,
        source: household.source,
        hits: 1,
      })
      .onConflictDoUpdate({
        target: [tvExposures.slug, tvExposures.household, tvExposures.minute, tvExposures.grp],
        set: { hits: sql`${tvExposures.hits} + 1` },
      });
}

/** The salt of a campaign's household hashes: its flight's when it has one, else its own. */
export function householdSalt(c: { salt: string; flightSalt?: string | null }): string {
  return c.flightSalt ?? c.salt;
}

/** Campaigns with impressions (or holdout calls) in the last 8 days, read at most every 5 minutes. */
let activeCache: { at: number; list: { slug: string; salt: string }[] } | null = null;

async function activeCampaigns(db: Db, now: Date): Promise<{ slug: string; salt: string }[]> {
  if (activeCache && now.getTime() - activeCache.at < 5 * 60_000) return activeCache.list;
  const since = rigaDay(new Date(now.getTime() - 8 * DAY_MS));
  const list = await db
    .selectDistinct({
      slug: tvCampaigns.slug,
      salt: sql<string>`coalesce(${tvCampaigns.flightSalt}, ${tvCampaigns.salt})`,
    })
    .from(tvCampaigns)
    .innerJoin(tvDaily, eq(tvDaily.slug, tvCampaigns.slug))
    .where(and(gte(tvDaily.day, since), inArray(tvDaily.kind, ["impression", "control"])));
  activeCache = { at: now.getTime(), list };
  return list;
}

/** For tests: forget the active campaigns read. */
export function resetActiveTvCampaigns() {
  activeCache = null;
}

/**
 * A person's page view, as a household for each running campaign
 * (docs/TV_PIXEL_BEST_PRACTICE.md §2.2): the address's salted hash per minute,
 * beside the day's visitor hash so a left-out visitor day can be dropped. Only
 * a public address counts; nothing is kept when no campaign runs.
 */
export async function recordHouseholdVisit(
  db: Db,
  input: { ip: string; visitorHash: string; day: string; now: Date },
): Promise<number> {
  const key = householdKey(input.ip);
  if (!key) return 0;
  const campaigns = await activeCampaigns(db, input.now);
  if (!campaigns.length) return 0;
  const minute = new Date(Math.floor(input.now.getTime() / 60_000) * 60_000);
  // Only for campaigns that still exist: the list is cached for five minutes, and one deleted
  // meanwhile would fail the whole insert on its foreign key, losing every campaign's row.
  const rows = sql.join(
    campaigns.map(
      (c) =>
        sql`(${c.slug}, ${householdHash(c.salt, key)}, ${minute.toISOString()}::timestamptz, ${input.day}::date, ${input.visitorHash})`,
    ),
    sql`, `,
  );
  await db.execute(sql`
    insert into tv_household_visits (slug, household, minute, day, visitor_hash)
    select v.slug, v.household, v.minute, v.day, v.visitor_hash
      from (values ${rows}) as v(slug, household, minute, day, visitor_hash)
      join tv_campaigns c on c.slug = v.slug
    on conflict do nothing`);
  return campaigns.length;
}

/** One opening of the short link (a person typing it or scanning the QR code). */
export async function recordTvLinkOpen(db: Db, slug: string, now = new Date()): Promise<void> {
  await bump(db, slug, rigaDay(now), "link");
}

export type TvStats = {
  campaign: TvCampaign;
  impressions: number;
  /** Unique devices over the period (the whole campaign when none is given). */
  reach: number;
  linkOpens: number;
  /** Visits that arrived through the short link (utm_medium=tv). */
  visits: number;
  /** Shop clicks by those visitors the same day. */
  shopClicks: number;
  days: { day: string; impressions: number; reach: number; linkOpens: number }[];
};

/** Inclusive Riga days ("YYYY-MM-DD") a figure covers; none = the whole campaign. */
export type DayRange = { from: string; to: string };

export async function tvStats(db: Db, range?: DayRange): Promise<TvStats[]> {
  const campaigns = await db.select().from(tvCampaigns).orderBy(desc(tvCampaigns.createdAt));
  const within = (col: Parameters<typeof gte>[0]) =>
    range ? [gte(col, range.from), lte(col, range.to)] : [];
  return Promise.all(
    campaigns.map(async (campaign) => {
      const daily = await db
        .select({ day: tvDaily.day, kind: tvDaily.kind, hits: tvDaily.hits })
        .from(tvDaily)
        .where(and(eq(tvDaily.slug, campaign.slug), ...within(tvDaily.day)));
      const reachPerDay = await db
        .select({ day: tvViewers.day, n: sql<number>`count(*)::int` })
        .from(tvViewers)
        .where(and(eq(tvViewers.slug, campaign.slug), ...within(tvViewers.day)))
        .groupBy(tvViewers.day);
      const [reach] = await db
        .select({ n: sql<number>`count(distinct ${tvViewers.viewerHash})::int` })
        .from(tvViewers)
        .where(and(eq(tvViewers.slug, campaign.slug), ...within(tvViewers.day)));
      const fromTv = and(
        eq(adLandings.utmMedium, campaign.kind === "display" ? "display" : "tv"),
        eq(adLandings.utmCampaign, campaign.slug),
        ...within(adLandings.day),
      );
      // Visits and shop clicks from the short link, without scripts and the admins' own
      // browsing: the same visitor days the site statistics leave out (cleanVisitor).
      const [visits] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(adLandings)
        .where(and(fromTv, cleanVisitor(adLandings.day, adLandings.visitorHash)));
      const [clicks] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(affiliateClicks)
        .innerJoin(adLandings, eq(adLandings.id, affiliateClicks.adLandingId))
        .where(
          and(
            fromTv,
            isNull(affiliateClicks.suspect),
            eq(affiliateClicks.internal, false),
            cleanVisitor(adLandings.day, adLandings.visitorHash),
          ),
        );
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

/**
 * A day's page views as the uplift needs them (raw visits: the last 35 days),
 * without the visitor days left out of every figure: scripts and the admins'
 * own browsing (docs/CLICK_QUALITY_PLAN.md §6).
 */
async function allPageViews(db: Db, day: string) {
  return db
    .select({
      visitorHash: visits.visitorHash,
      at: visits.createdAt,
      section: visits.section,
      client: visits.client,
    })
    .from(visits)
    .where(and(eq(visits.day, day), cleanVisitor(visits.day, visits.visitorHash)));
}

/** Each visitor's channel that day, from their ad and post landings ("direct" without any). */
async function channelsOn(db: Db, day: string): Promise<Map<string, Channel>> {
  const rows = await db
    .select({
      visitorHash: adLandings.visitorHash,
      gclid: adLandings.gclid,
      utmSource: adLandings.utmSource,
      utmMedium: adLandings.utmMedium,
      utmCampaign: adLandings.utmCampaign,
      utmTerm: adLandings.utmTerm,
      at: adLandings.createdAt,
    })
    .from(adLandings)
    .where(eq(adLandings.day, day));
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.visitorHash, [...(by.get(r.visitorHash) ?? []), r]);
  return new Map([...by].map(([hash, list]) => [hash, visitorChannel(list)]));
}

/**
 * The day's page views TV is measured on: people (no scripts, no admins) who came through a
 * channel TV can cause - direct or organic, the TV link, a Google brand search - and not those
 * another channel sent: other Google Ads, Meta ads, social posts, e-mails, partners
 * (docs/TV_ANALYTICS_PLAN.md §8). The baseline is drawn the same way.
 */
async function pageViews(db: Db, day: string) {
  const [rows, channel] = await Promise.all([allPageViews(db, day), channelsOn(db, day)]);
  return rows.filter((r) => TV_ELIGIBLE.has(channel.get(r.visitorHash) ?? "direct"));
}

/** That day's visitors (people with a page view) per channel, for the mix shown next to the uplift. */
export async function dayChannelMix(db: Db, day: string): Promise<ChannelMix> {
  const [rows, channel] = await Promise.all([allPageViews(db, day), channelsOn(db, day)]);
  const visitors = [...new Set(rows.map((r) => r.visitorHash))];
  return mixOf(visitors.map((h) => channel.get(h) ?? "direct"));
}

/** Channel mixes added up, in the fixed channel order. */
export function sumMix(mixes: (ChannelMix | null | undefined)[]): ChannelMix {
  const out: ChannelMix = {};
  for (const c of CHANNELS) {
    const n = mixes.reduce((t, m) => t + (m?.[c] ?? 0), 0);
    if (n) out[c] = n;
  }
  return out;
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
  const baseline: TvBaseline = {
    from,
    to,
    days: days.length,
    sessions: baselineProfile(days),
    filter: CHANNEL_FILTER,
  };
  await db.update(tvCampaigns).set({ baseline }).where(eq(tvCampaigns.slug, campaign.slug));
  return baseline;
}

/**
 * Draws the baseline again from the raw visits, without the visitor days left out
 * since (scripts, the admins' own browsing), and the stored uplift days with it.
 * Refused when the raw visits of the baseline's days are no longer kept (35 days):
 * the old baseline then stays, so the case study's comparison never loses its ground.
 */
export async function recomputeTvBaseline(
  db: Db,
  campaign: TvCampaign,
  now = new Date(),
): Promise<{ ok: true; baseline: TvBaseline; days: number } | { ok: false; error: "none" | "expired" }> {
  const first = await firstImpressionDay(db, campaign.slug);
  if (!first) return { ok: false, error: "none" };
  const from = campaign.baseline?.from ?? shiftDay(first, -BASELINE_DAYS);
  const kept = rigaDay(new Date(now.getTime() - (RAW_RETENTION_DAYS - 1) * DAY_MS));
  if (from < kept) return { ok: false, error: "expired" };
  const baseline = await redrawBaseline(db, campaign, kept);
  if (!baseline) return { ok: false, error: "none" };
  const days = await rollupTvUplift(db, now);
  return { ok: true, baseline, days };
}

/** A new baseline from the raw visits, and the stored days still in them cleared for the rollup. */
async function redrawBaseline(db: Db, campaign: TvCampaign, kept: string): Promise<TvBaseline | null> {
  await db.update(tvCampaigns).set({ baseline: null }).where(eq(tvCampaigns.slug, campaign.slug));
  const baseline = await ensureTvBaseline(db, { ...campaign, baseline: null });
  if (!baseline) return null;
  // Every stored day still in the raw visits is computed again against the new baseline.
  await db.delete(tvUplift).where(and(eq(tvUplift.slug, campaign.slug), gte(tvUplift.day, kept)));
  return baseline;
}

/**
 * A baseline drawn before the channel filter is drawn again once, with the stored days still
 * in the raw visits, so the comparison counts the same visitors on both sides. When its raw
 * visits are gone it is marked "all" and kept: the case study never loses its ground.
 */
async function refilterBaseline(db: Db, c: TvCampaign, now: Date): Promise<TvBaseline | null> {
  if (!c.baseline || c.baseline.filter) return c.baseline ?? null;
  const kept = rigaDay(new Date(now.getTime() - (RAW_RETENTION_DAYS - 1) * DAY_MS));
  if (c.baseline.from < kept) {
    const marked = { ...c.baseline, filter: "all" };
    await db.update(tvCampaigns).set({ baseline: marked }).where(eq(tvCampaigns.slug, c.slug));
    return marked;
  }
  return redrawBaseline(db, c, kept);
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
        isNull(affiliateClicks.suspect),
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
    const baseline = (await refilterBaseline(db, c, now)) ?? (await ensureTvBaseline(db, c));
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
      const u = { ...(await computeTvUpliftDay(db, campaign, day)), channels: await dayChannelMix(db, day) };
      await db
        .insert(tvUplift)
        .values({ slug: c.slug, day, ...u, computedAt: now })
        .onConflictDoUpdate({ target: [tvUplift.slug, tvUplift.day], set: { ...u, computedAt: now } });
      written++;
    }
    // Household figures settle over the 7-day window: the last 8 finished days are drawn again
    // each night, and kept in the row once the raw household data is gone (21 days).
    for (const day of days.filter((d) => d >= shiftDay(today, -8))) {
      const households = await computeHouseholdDay(db, campaign, day);
      if (households)
        await db
          .update(tvUplift)
          .set({ households })
          .where(and(eq(tvUplift.slug, c.slug), eq(tvUplift.day, day)));
    }
  }
  return written;
}

export type TvReport = {
  campaign: TvCampaign;
  /** The campaign's days with impressions, newest first, each with its uplift figures. */
  days: ({ day: string; live: boolean; channels?: ChannelMix | null } & DayUplift)[];
  summary: UpliftSummary;
  /**
   * Visitors per channel over the days shown (docs/TV_ANALYTICS_PLAN.md §8): the uplift counts
   * only direct, tv and google_brand; the rest came through another channel. Null for days before 11 Nov.
   */
  channels: ChannelMix;
  baseline: TvBaseline | null;
  /** Searches containing "trilio" per day (Search Console), from the baseline's first day on. */
  brand: { day: string; clicks: number; impressions: number }[];
  /**
   * The flight's own control (docs/TV_PIXEL_BEST_PRACTICE.md §2.3, the time split): days
   * between the first and the last impression without a single one. Their sessions per
   * bucket are what the same minutes bring without TV in the same weeks; null with fewer than two.
   */
  offDays: { days: string[]; sessionsAfter: number; expectedAfter: number; uplift: number } | null;
  /** Household view-through per day (newest first), where the pixel brings a household address. */
  households: ({ day: string } & TvHouseholdFigures)[];
};

/** Stored days plus today's live figures, summarised (docs/TV_ANALYTICS_PLAN.md §3). */
export async function tvReport(
  db: Db,
  slug: string,
  now = new Date(),
  range?: DayRange,
): Promise<TvReport | null> {
  const campaign = await getTvCampaign(db, slug);
  if (!campaign) return null;
  const today = rigaDay(now);
  const first = await firstImpressionDay(db, slug);
  const stored = await db.select().from(tvUplift).where(eq(tvUplift.slug, slug));
  const have = new Map(stored.map((r) => [String(r.day), r]));
  const days: TvReport["days"] = [];
  if (first) {
    const cutoff = rigaDay(new Date(now.getTime() - (RAW_RETENTION_DAYS - 1) * DAY_MS));
    const from = range && range.from > first ? range.from : first;
    const to = range && range.to < today ? range.to : today;
    for (const day of await impressionDays(db, slug, from, to)) {
      const row = have.get(day);
      if (row && day !== today) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the key columns are not figures
        const { slug: _slug, day: _day, computedAt: _at, ...figures } = row;
        days.push({ day, live: false, ...figures });
      } else if (day >= cutoff) {
        days.push({
          day,
          live: true,
          ...(await computeTvUpliftDay(db, campaign, day)),
          channels: await dayChannelMix(db, day),
        });
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
    .where(
      and(
        gte(seoQueries.day, range && range.from > brandFrom ? range.from : brandFrom),
        ...(range ? [lte(seoQueries.day, range.to)] : []),
        sql`${seoQueries.query} ilike '%trilio%'`,
      ),
    )
    .groupBy(seoQueries.day)
    .orderBy(asc(seoQueries.day));
  // Household figures: stored for finished days, computed for days still in the raw tables.
  const households: TvReport["households"] = [];
  const hhKept = shiftDay(today, -HOUSEHOLD_RETENTION_DAYS + 1);
  for (const d of days) {
    const stored = have.get(d.day)?.households ?? null;
    const f =
      !d.live && stored ? stored : d.day >= hhKept ? await computeHouseholdDay(db, campaign, d.day) : stored;
    if (f) households.push({ day: d.day, ...f });
  }
  return {
    campaign,
    days,
    summary: summarise([...days].reverse(), base),
    channels: sumMix(days.map((d) => d.channels)),
    baseline: campaign.baseline ?? null,
    brand: brand.map((b) => ({ day: b.day, clicks: Number(b.clicks), impressions: Number(b.impressions) })),
    offDays: first ? await offDayControl(db, slug, first, today, days, now) : null,
    households,
  };
}

/* ---------- the flight's own control: days without TV (docs/TV_PIXEL_BEST_PRACTICE.md §2.3) ---------- */

async function offDayControl(
  db: Db,
  slug: string,
  first: string,
  today: string,
  days: TvReport["days"],
  now: Date,
): Promise<TvReport["offDays"]> {
  const cutoff = rigaDay(new Date(now.getTime() - (RAW_RETENTION_DAYS - 1) * DAY_MS));
  const all = await impressionDays(db, slug, first, today);
  const last = all[all.length - 1];
  if (!last) return null;
  const on = new Set(all);
  const off: string[] = [];
  for (let day = first > cutoff ? first : cutoff; day < last; day = shiftDay(day, 1))
    if (!on.has(day)) off.push(day);
  const profiles: number[][] = [];
  const used: string[] = [];
  for (const day of off) {
    const views = await pageViews(db, day);
    if (views.length === 0) continue;
    profiles.push(perBucket(sessionsOf(views)));
    used.push(day);
  }
  if (profiles.length < 2) return null;
  const profile = baselineProfile(profiles);
  let sessionsAfter = 0;
  let expectedAfter = 0;
  for (const d of days) {
    const after = afterTv(d.buckets.map(([imp]) => imp));
    for (let b = 0; b < after.length; b++) {
      if (!after[b]) continue;
      sessionsAfter += d.buckets[b]?.[1] ?? 0;
      expectedAfter += profile[b] ?? 0;
    }
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    days: used,
    sessionsAfter,
    expectedAfter: r2(expectedAfter),
    uplift: r2(sessionsAfter - expectedAfter),
  };
}

/* ---------- household view-through (docs/TV_PIXEL_BEST_PRACTICE.md §2.2) ---------- */

/** Household exposures and visits are kept 21 days: the 7-day window of the last two weeks. */
export const HOUSEHOLD_RETENTION_DAYS = 21;

/** What one day's pixel requests carried: counters and distinct addresses per source. */
async function pixelDay(db: Db, slug: string, day: string) {
  const counts = await db
    .select({ key: tvPixelCounts.key, hits: tvPixelCounts.hits })
    .from(tvPixelCounts)
    .where(and(eq(tvPixelCounts.slug, slug), eq(tvPixelCounts.day, day)));
  const distinct = await db
    .select({ source: tvPixelAddresses.source, n: sql<number>`count(*)::int` })
    .from(tvPixelAddresses)
    .where(and(eq(tvPixelAddresses.slug, slug), eq(tvPixelAddresses.day, day)))
    .groupBy(tvPixelAddresses.source);
  const [reach] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tvViewers)
    .where(and(eq(tvViewers.slug, slug), eq(tvViewers.day, day)));
  const map = new Map(counts.map((c) => [c.key, Number(c.hits)]));
  return {
    counts: map,
    distinct: Object.fromEntries(distinct.map((d) => [d.source, Number(d.n)])) as Record<string, number>,
    reach: Number(reach?.n ?? 0),
  };
}

/** Which household address source a day's figures rest on (macro, header, or many forwarded addresses). */
async function sourceOfDay(db: Db, slug: string, day: string) {
  const d = await pixelDay(db, slug, day);
  return usableSource({
    reach: d.reach,
    distinct: d.distinct,
    forwarded: (d.counts.get("xff:2") ?? 0) + (d.counts.get("xff:3") ?? 0),
    impressions: d.counts.get("total") ?? 0,
  });
}

/**
 * One day's household view-through: the households exposed that day (by the
 * day's usable address source), and of them those with a page view by a
 * person 0–20 minutes after an exposure and within 7 days; the same for the
 * holdout. Null when the day's pixel brought no usable household address.
 */
export async function computeHouseholdDay(
  db: Db,
  campaign: TvCampaign,
  day: string,
): Promise<TvHouseholdFigures | null> {
  const { source } = await sourceOfDay(db, campaign.slug, day);
  if (!source) return null;
  const start = rigaDayStart(day);
  const end = new Date(start.getTime() + DAY_MS);
  const exposures = await db
    .select({ household: tvExposures.household, at: tvExposures.minute, grp: tvExposures.grp })
    .from(tvExposures)
    .where(
      and(
        eq(tvExposures.slug, campaign.slug),
        eq(tvExposures.source, source),
        gte(tvExposures.minute, start),
        lt(tvExposures.minute, end),
      ),
    );
  if (!exposures.length) return null;
  const seen = await db
    .select({ household: tvHouseholdVisits.household, at: tvHouseholdVisits.minute })
    .from(tvHouseholdVisits)
    .where(
      and(
        eq(tvHouseholdVisits.slug, campaign.slug),
        gte(tvHouseholdVisits.minute, start),
        lt(tvHouseholdVisits.minute, new Date(end.getTime() + 7 * DAY_MS)),
        inArray(tvHouseholdVisits.household, [...new Set(exposures.map((e) => e.household))]),
        cleanVisitor(tvHouseholdVisits.day, tvHouseholdVisits.visitorHash),
      ),
    );
  const f = householdFigures(
    exposures.map((e) => ({ household: e.household, at: e.at, grp: e.grp === "control" ? "control" : "ad" })),
    seen,
  );
  return { source, ...f };
}

/** The household figures over several days, with the holdout lift when there is a holdout. */
export function householdSummary(days: TvHouseholdFigures[]) {
  const sum = (k: keyof Omit<TvHouseholdFigures, "source">) => days.reduce((n, d) => n + d[k], 0);
  const exposed = sum("exposed");
  const control = sum("control");
  return {
    sources: [...new Set(days.map((d) => d.source as AddressSource))],
    exposed,
    direct: sum("direct"),
    week: sum("week"),
    control,
    controlDirect: sum("controlDirect"),
    controlWeek: sum("controlWeek"),
    liftDirect: holdoutLift(exposed, sum("direct"), control, sum("controlDirect")),
    liftWeek: holdoutLift(exposed, sum("week"), control, sum("controlWeek")),
  };
}

/* ---------- what the pixel carries (docs/TV_PIXEL_BEST_PRACTICE.md §3, step 1) ---------- */

export type TvPixelReport = {
  /** Per day, newest first. */
  days: {
    day: string;
    total: number;
    control: number;
    /** Requests from devices that opted out of ad tracking (counted, never followed). */
    optOut: number;
    hops: [number, number, number, number];
    headers: Record<string, number>;
    params: Record<string, number>;
    distinct: Record<string, number>;
    reach: number;
    household: ReturnType<typeof usableSource>;
  }[];
  /** Over the period: impressions per creative, channel, position, request and device family. */
  dims: Record<
    "cr" | "ch" | "cs" | "dt" | "pos" | "ua" | "dua" | "co" | "du" | "pg" | "gn" | "dp" | "pl" | "it",
    { value: string; hits: number }[]
  >;
  /**
   * Go3's site sections decoded (go3-section.ts): impressions per screen, device,
   * content type (live, catch-up, on-demand) and live channel.
   */
  sections: Record<"screen" | "device" | "type" | "channel", { value: string; hits: number }[]>;
  /** Devices by impressions over the period: 1, 2, 3–4, 5 and more. */
  frequency: { band: "1" | "2" | "3-4" | "5+"; devices: number }[];
  /**
   * Households by Go3 subscription (the customer part of the viewer id), over the days that
   * carry it; null before the first such day. Child profiles are the "C" ones.
   */
  accounts: {
    households: number;
    profiles: number;
    impressions: number;
    childProfiles: number;
    childImpressions: number;
    frequency: { band: "1" | "2" | "3-4" | "5+"; households: number }[];
  } | null;
};

export async function tvPixelReport(db: Db, slug: string, range: DayRange): Promise<TvPixelReport> {
  const rows = await db
    .select({
      day: sql<string>`${tvPixelCounts.day}::text`,
      key: tvPixelCounts.key,
      hits: tvPixelCounts.hits,
    })
    .from(tvPixelCounts)
    .where(
      and(eq(tvPixelCounts.slug, slug), gte(tvPixelCounts.day, range.from), lte(tvPixelCounts.day, range.to)),
    );
  const dayList = [...new Set(rows.map((r) => r.day))].sort((a, b) => b.localeCompare(a));
  const days: TvPixelReport["days"] = [];
  for (const day of dayList) {
    const d = await pixelDay(db, slug, day);
    const pick = (prefix: string) =>
      Object.fromEntries(
        [...d.counts].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]),
      );
    days.push({
      day,
      total: d.counts.get("total") ?? 0,
      control: d.counts.get("grp:control") ?? 0,
      optOut: d.counts.get("lat:1") ?? 0,
      hops: [0, 1, 2, 3].map((n) => d.counts.get(`xff:${n}`) ?? 0) as [number, number, number, number],
      headers: pick("hdr:"),
      params: pick("param:"),
      distinct: d.distinct,
      reach: d.reach,
      household: usableSource({
        reach: d.reach,
        distinct: d.distinct,
        forwarded: (d.counts.get("xff:2") ?? 0) + (d.counts.get("xff:3") ?? 0),
        impressions: d.counts.get("total") ?? 0,
      }),
    });
  }
  const dims = {
    cr: new Map(),
    ch: new Map(),
    cs: new Map(),
    dt: new Map(),
    pos: new Map(),
    ua: new Map(),
    dua: new Map(),
    co: new Map(),
    du: new Map(),
    pg: new Map(),
    gn: new Map(),
    dp: new Map(),
    pl: new Map(),
    it: new Map(),
  } as Record<keyof TvPixelReport["dims"], Map<string, number>>;
  for (const r of rows) {
    const i = r.key.indexOf(":");
    const k = r.key.slice(0, i) as keyof TvPixelReport["dims"];
    if (!(k in dims)) continue;
    const v = r.key.slice(i + 1);
    dims[k].set(v, (dims[k].get(v) ?? 0) + Number(r.hits));
  }
  const list = (m: Map<string, number>) =>
    [...m]
      .map(([value, hits]) => ({ value, hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 15);
  const decoded = { screen: new Map(), device: new Map(), type: new Map(), channel: new Map() } as Record<
    keyof TvPixelReport["sections"],
    Map<string, number>
  >;
  for (const [raw, hits] of dims.cs) {
    const s = parseSection(raw);
    const add = (k: keyof TvPixelReport["sections"], v: string) =>
      decoded[k].set(v, (decoded[k].get(v) ?? 0) + hits);
    add("screen", s.screen);
    add("device", deviceLabel(s.device));
    add("type", s.type);
    if (s.channel) add("channel", s.channel);
  }
  const freq = (await db.execute(sql`
    select case when n = 1 then '1' when n = 2 then '2' when n <= 4 then '3-4' else '5+' end as band,
           count(*)::int as devices
      from (select viewer_hash, sum(impressions) as n from tv_viewers
             where slug = ${slug} and day between ${range.from}::date and ${range.to}::date
             group by viewer_hash) v
      group by 1`)) as unknown as { band: TvPixelReport["frequency"][number]["band"]; devices: number }[];
  const bands = new Map(freq.map((f) => [f.band, Number(f.devices)]));
  const [acct] = (await db.execute(sql`
    select count(distinct account_hash)::int as households, count(distinct viewer_hash)::int as profiles,
           coalesce(sum(impressions), 0)::int as impressions,
           count(distinct viewer_hash) filter (where child)::int as child_profiles,
           coalesce(sum(impressions) filter (where child), 0)::int as child_impressions
      from tv_viewers
     where slug = ${slug} and day between ${range.from}::date and ${range.to}::date
       and account_hash is not null`)) as unknown as {
    households: number;
    profiles: number;
    impressions: number;
    child_profiles: number;
    child_impressions: number;
  }[];
  const acctFreq = (await db.execute(sql`
    select case when n = 1 then '1' when n = 2 then '2' when n <= 4 then '3-4' else '5+' end as band,
           count(*)::int as households
      from (select account_hash, sum(impressions) as n from tv_viewers
             where slug = ${slug} and day between ${range.from}::date and ${range.to}::date
               and account_hash is not null
             group by account_hash) v
      group by 1`)) as unknown as { band: TvPixelReport["frequency"][number]["band"]; households: number }[];
  const acctBands = new Map(acctFreq.map((f) => [f.band, Number(f.households)]));
  return {
    days,
    dims: {
      cr: list(dims.cr),
      ch: list(dims.ch),
      cs: list(dims.cs),
      dt: list(dims.dt),
      pos: list(dims.pos),
      ua: list(dims.ua),
      dua: list(dims.dua),
      co: list(dims.co),
      du: list(dims.du),
      pg: list(dims.pg),
      gn: list(dims.gn),
      dp: list(dims.dp),
      pl: list(dims.pl),
      it: list(dims.it),
    },
    sections: {
      screen: list(decoded.screen),
      device: list(decoded.device),
      type: list(decoded.type),
      channel: list(decoded.channel),
    },
    frequency: (["1", "2", "3-4", "5+"] as const).map((band) => ({ band, devices: bands.get(band) ?? 0 })),
    accounts: Number(acct?.households)
      ? {
          households: Number(acct!.households),
          profiles: Number(acct!.profiles),
          impressions: Number(acct!.impressions),
          childProfiles: Number(acct!.child_profiles),
          childImpressions: Number(acct!.child_impressions),
          frequency: (["1", "2", "3-4", "5+"] as const).map((band) => ({
            band,
            households: acctBands.get(band) ?? 0,
          })),
        }
      : null,
  };
}

/** Housekeeping: household rows and distinct-address hashes older than 21 days are deleted. */
export async function purgeTvHouseholds(db: Db, now = new Date()): Promise<number> {
  const cutoffDay = rigaDay(new Date(now.getTime() - HOUSEHOLD_RETENTION_DAYS * DAY_MS));
  const cutoff = rigaDayStart(cutoffDay);
  const a = await db
    .delete(tvExposures)
    .where(lt(tvExposures.minute, cutoff))
    .returning({ s: tvExposures.slug });
  const b = await db
    .delete(tvHouseholdVisits)
    .where(lt(tvHouseholdVisits.minute, cutoff))
    .returning({ s: tvHouseholdVisits.slug });
  const c = await db
    .delete(tvPixelAddresses)
    .where(lt(tvPixelAddresses.day, cutoffDay))
    .returning({ s: tvPixelAddresses.slug });
  return a.length + b.length + c.length;
}

/* ---------- TV and display in one flight (docs/DISPLAY_PLAN.md §3) ---------- */

/**
 * Links two campaigns into one flight: from now on both hash household addresses with one
 * shared salt, so a household that saw the TV spot and the banner is the same hash in both.
 * Exposures from before the link stay under each campaign's own salt and are not compared.
 */
export async function linkFlight(
  db: Db,
  a: string,
  b: string,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: "flight_same" | "flight_none" | "flight_taken" }> {
  if (a === b) return { ok: false, error: "flight_same" };
  const [ca, cb] = await Promise.all([getTvCampaign(db, a), getTvCampaign(db, b)]);
  if (!ca || !cb) return { ok: false, error: "flight_none" };
  if (ca.flightWith || cb.flightWith) return { ok: false, error: "flight_taken" };
  const flightSalt = randomBytes(24).toString("base64url");
  await db.transaction(async (tx) => {
    await tx
      .update(tvCampaigns)
      .set({ flightSalt, flightWith: b, flightAt: now })
      .where(eq(tvCampaigns.slug, a));
    await tx
      .update(tvCampaigns)
      .set({ flightSalt, flightWith: a, flightAt: now })
      .where(eq(tvCampaigns.slug, b));
  });
  activeCache = null;
  return { ok: true };
}

/** Ends a flight: both campaigns go back to their own salt, and the shared one is forgotten. */
export async function unlinkFlight(db: Db, slug: string): Promise<void> {
  const c = await getTvCampaign(db, slug);
  if (!c?.flightWith) return;
  await db
    .update(tvCampaigns)
    .set({ flightSalt: null, flightWith: null, flightAt: null })
    .where(inArray(tvCampaigns.slug, [c.slug, c.flightWith]));
  // The shared salt is forgotten, so its device hashes mean nothing any more.
  await db
    .update(tvViewers)
    .set({ deviceHash: null })
    .where(inArray(tvViewers.slug, [c.slug, c.flightWith]));
  activeCache = null;
}

export type FlightOverlap = {
  partner: { slug: string; name: string; kind: string };
  since: Date;
  /** Households that saw only this campaign, only the partner, or both; and of each, those that came. */
  groups: Record<"own" | "partner" | "both", { households: number; came: number }>;
  /**
   * The same split by device advertising id, exact where both trackers carry it (apps);
   * null when neither campaign has received one since the link.
   */
  devices: Record<"own" | "partner" | "both", number> | null;
};

/**
 * Households of a flight since it was linked (kept 21 days): which campaign each saw, and
 * whether a person from that household opened Trilio after its first exposure.
 */
export async function flightOverlap(db: Db, slug: string): Promise<FlightOverlap | null> {
  const c = await getTvCampaign(db, slug);
  if (!c?.flightWith || !c.flightAt) return null;
  const partner = await getTvCampaign(db, c.flightWith);
  if (!partner) return null;
  const since = c.flightAt.toISOString();
  const rows = (await db.execute(sql`
    with e as (
      select household, min(minute) as first,
             bool_or(slug = ${c.slug}) as own, bool_or(slug = ${partner.slug}) as partner
        from tv_exposures
       where slug in (${c.slug}, ${partner.slug}) and grp = 'ad' and minute >= ${since}::timestamptz
       group by household
    ), v as (
      select distinct e.household
        from e join tv_household_visits h
          on h.household = e.household and h.slug in (${c.slug}, ${partner.slug}) and h.minute >= e.first
    )
    select case when e.own and e.partner then 'both' when e.own then 'own' else 'partner' end as grp,
           count(*)::int as households, count(v.household)::int as came
      from e left join v on v.household = e.household
     group by 1`)) as unknown as { grp: "own" | "partner" | "both"; households: number; came: number }[];
  const groups: FlightOverlap["groups"] = {
    own: { households: 0, came: 0 },
    partner: { households: 0, came: 0 },
    both: { households: 0, came: 0 },
  };
  for (const r of rows) groups[r.grp] = { households: Number(r.households), came: Number(r.came) };
  const dev = (await db.execute(sql`
    select case when bool_or(slug = ${c.slug}) and bool_or(slug = ${partner.slug}) then 'both'
                when bool_or(slug = ${c.slug}) then 'own' else 'partner' end as grp
      from tv_viewers
     where slug in (${c.slug}, ${partner.slug}) and device_hash is not null
     group by device_hash`)) as unknown as { grp: "own" | "partner" | "both" }[];
  const devices = dev.length ? { own: 0, partner: 0, both: 0 } : null;
  for (const r of dev) devices![r.grp]++;
  return {
    partner: { slug: partner.slug, name: partner.name, kind: partner.kind },
    since: c.flightAt,
    groups,
    devices,
  };
}
