import { timingSafeEqual } from "node:crypto";
import type { Db } from "@/db/client";
import { parseRange, rangeDays } from "@/domain/admin/stats";
import {
  clickSourceStats,
  confidenceStats,
  leftOutVisitors,
  searchStats,
  shopStats,
  suspectClickDetail,
  visitStats,
} from "@/services/admin/stats";
import { flightOverlap, householdSummary, tvPixelReport, tvReport, tvStats } from "@/services/growth/tv";
import { notifyFunnel } from "@/services/notify/events";
import { botStats, clientStats } from "@/services/visits/visits";

// Read-only statistics for the owner's assistant (owner, 8 Nov 2026: "all TV
// campaign statistics I could ask you directly"): the same aggregates the admin
// shows, as JSON, behind a bearer token set in STATS_API_TOKEN. No e-mail
// address, note text or other personal data is part of any figure.

/** Whether the request carries the configured token; never true while none is configured. */
export function statsAuthorised(header: string | null, token = process.env.STATS_API_TOKEN): boolean {
  if (!token || token.length < 24) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1]!.trim());
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A period like the admin's: today, 7, 30 or 90 days (default 7). */
function period(raw: string | null, now: Date) {
  const key = parseRange(raw ?? "7");
  return { key, ...rangeDays(key, now) };
}

export async function tvStatsJson(db: Db, rawPeriod: string | null, now = new Date()) {
  const p = period(rawPeriod, now);
  const range = { from: p.from, to: p.to };
  const campaigns = await tvStats(db, range);
  return {
    period: { key: p.key, from: p.from, to: p.to },
    campaigns: await Promise.all(
      campaigns.map(async (c) => {
        const report = await tvReport(db, c.campaign.slug, now, range);
        const pixel = await tvPixelReport(db, c.campaign.slug, range);
        const overlap = await flightOverlap(db, c.campaign.slug);
        return {
          slug: c.campaign.slug,
          name: c.campaign.name,
          // "tv": Go3's ad server calls the tracker. "display": a banner; totals.shortLink* are its clicks.
          kind: c.campaign.kind,
          source: c.campaign.source,
          // A TV campaign and a display campaign measured together: households that saw one or both.
          flight: overlap
            ? { partner: overlap.partner.slug, since: overlap.since.toISOString(), groups: overlap.groups }
            : null,
          landingPath: c.campaign.landingPath,
          totals: {
            impressions: c.impressions,
            reach: c.reach,
            shortLinkOpens: c.linkOpens,
            shortLinkVisits: c.visits,
            shortLinkShopClicks: c.shopClicks,
          },
          perDay: c.days,
          baseline: report?.baseline ?? null,
          effect: report
            ? {
                summary: { ...report.summary, profile: undefined },
                profile: report.summary.profile,
                days: report.days.map((d) => ({ ...d, buckets: undefined })),
                offDays: report.offDays,
                households: report.households,
                householdSummary: report.households.length ? householdSummary(report.households) : null,
                brandSearches: report.brand,
                // Visitors per channel; the uplift counts only direct, tv and google_brand.
                channels: report.channels,
                upliftCounts: ["direct", "tv", "google_brand"],
              }
            : null,
          pixel,
        };
      }),
    ),
    notes: [
      "Sessions, the baseline and households leave out visitor days with a script's request or an admin's own browsing.",
      "Sessions and the baseline count only visitors TV can bring (direct/organic, the TV link, Google brand search); other paid, social and e-mail visitors are left out and shown in effect.channels.",
      "A bucket is 10 minutes; 'after TV' is a bucket with impressions or right after one (0–20 min).",
      "pixel.accounts counts households by Go3 subscription (the customer part of the viewer id), with child-profile impressions; null before the first day that carries it.",
      "Household figures need a household address from the pixel (macro, X-Device-IP or many forwarded addresses); see pixel.days[].household.",
    ],
  };
}

export async function siteStatsJson(db: Db, rawPeriod: string | null, now = new Date()) {
  const p = period(rawPeriod, now);
  const [visits, prevVisits, searches, shops, sources, suspects, leftOut, bots, clients, funnel, confidence] =
    await Promise.all([
      visitStats(db, p.from, p.to, now),
      visitStats(db, p.prevFrom, p.prevTo, now),
      searchStats(db, p.from, p.to),
      shopStats(db, p.from, p.to),
      clickSourceStats(db, p.from, p.to),
      suspectClickDetail(db, p.from, p.to),
      leftOutVisitors(db, p.from, p.to),
      botStats(db, p.from, p.to),
      clientStats(db, p.from, p.to),
      notifyFunnel(db, p.from, p.to),
      confidenceStats(db, p.from, p.to),
    ]);
  return {
    period: { key: p.key, from: p.from, to: p.to, previous: { from: p.prevFrom, to: p.prevTo } },
    visitors: visits.total.visitors,
    views: visits.total.views,
    previous: { visitors: prevVisits.total.visitors, views: prevVisits.total.views },
    perDay: visits.days.map((d, i) => ({ ...d, searches: searches.days[i]?.searches ?? 0 })),
    sections: visits.sections,
    topPaths: visits.paths.slice(0, 30),
    clients,
    searches: { total: searches.total, subcategories: searches.subcategories },
    shopClicks: {
      byShop: shops,
      bySource: sources.sources,
      people: sources.people,
      internal: sources.internal,
    },
    quality: {
      suspectClicks: sources.suspect,
      suspectDetail: suspects,
      leftOutVisitorDays: leftOut,
      filteredBots: bots,
    },
    notifyFunnel: funnel,
    confidence: { ...confidence, notes: undefined },
  };
}
