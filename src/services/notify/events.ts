import { and, gte, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { uiEvents } from "@/db/schema";
import { isBot, rigaDay, visitorHash } from "@/domain/analytics/visits";
import { adLandingFor } from "@/services/growth/landings";
import { saltFor } from "@/services/visits/visits";

// The notify funnel without cookies (docs/PRICE_NOTIFY_PLAN.md §5 PR 3): each
// step is a row with the day's anonymous visitor hash, the same hash the
// visit statistics use, so results visitors and taps line up per day.

/** The request's steps, and the question before the shop (shown; answered with the shop). */
export const NOTIFY_EVENTS = [
  "notify_tap",
  "notify_sent",
  "notify_confirmed",
  "ask_shown",
  "ask_shop",
] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export type Who = { ip: string; userAgent: string | null; now?: Date };

/** Today's visitor hash and ad visit for this request, or null for a bot. */
export async function visitorOf(
  db: Db,
  who: Who,
): Promise<{ hash: string; adLandingId: string | null } | null> {
  if (isBot(who.userAgent)) return null;
  const now = who.now ?? new Date();
  const hash = visitorHash(await saltFor(db, rigaDay(now)), who.ip, who.userAgent ?? "");
  const adLandingId = await adLandingFor(db, who).catch(() => null);
  return { hash, adLandingId };
}

export async function recordUiEvent(
  db: Db,
  who: Who,
  event: NotifyEvent,
  subcategoryId: string | null,
): Promise<void> {
  const visitor = await visitorOf(db, who);
  if (!visitor) return;
  await db.insert(uiEvents).values({
    day: rigaDay(who.now ?? new Date()),
    visitorHash: visitor.hash,
    event,
    subcategoryId,
    adLandingId: visitor.adLandingId,
  });
}

export type FunnelRow = {
  subcategoryId: string;
  resultsVisitors: number;
  taps: number;
  sent: number;
  confirmed: number;
  /** Of the visitors who saw results, how many came from an ad. */
  adVisitors: number;
  /** Saw the question before the shop (docs/PRICE_NOTIFY_PLAN.md §8.4) and went to the shop from it. */
  askShown: number;
  askShop: number;
};

/**
 * Per subcategory between two Riga days: visitors who saw results, visitors
 * who tapped "Paziņot", e-mails entered and confirmations. Visitors are
 * distinct per day, as in the visit statistics.
 */
export async function notifyFunnel(db: Db, from: string, to: string): Promise<FunnelRow[]> {
  // Raw visits are kept 35 days (RAW_RETENTION_DAYS), enough for this panel's 7- and 30-day views.
  const results = (await db.execute(sql`
    select subcategory as sub, count(distinct visitor_hash || day)::int as n
      from visits where section = 'results' and subcategory is not null and day between ${from} and ${to}
      group by subcategory`)) as unknown as { sub: string; n: number }[];
  const ads = (await db.execute(sql`
    select v.subcategory as sub, count(distinct v.visitor_hash || v.day)::int as n
      from visits v join ad_landings a on a.day = v.day and a.visitor_hash = v.visitor_hash
      where v.section = 'results' and v.subcategory is not null and v.day between ${from} and ${to}
      group by v.subcategory`)) as unknown as { sub: string; n: number }[];
  const events = await db
    .select({
      sub: uiEvents.subcategoryId,
      event: uiEvents.event,
      n: sql<number>`count(distinct ${uiEvents.visitorHash} || ${uiEvents.day})::int`,
    })
    .from(uiEvents)
    .where(and(gte(uiEvents.day, from), lte(uiEvents.day, to)))
    .groupBy(uiEvents.subcategoryId, uiEvents.event);
  const rows = new Map<string, FunnelRow>();
  const row = (sub: string) => {
    if (!rows.has(sub))
      rows.set(sub, {
        subcategoryId: sub,
        resultsVisitors: 0,
        taps: 0,
        sent: 0,
        confirmed: 0,
        adVisitors: 0,
        askShown: 0,
        askShop: 0,
      });
    return rows.get(sub)!;
  };
  for (const r of results) row(r.sub).resultsVisitors += Number(r.n);
  for (const r of ads) row(r.sub).adVisitors += Number(r.n);
  for (const e of events) {
    if (!e.sub) continue;
    const r = row(e.sub);
    if (e.event === "notify_tap") r.taps += Number(e.n);
    else if (e.event === "notify_sent") r.sent += Number(e.n);
    else if (e.event === "notify_confirmed") r.confirmed += Number(e.n);
    else if (e.event === "ask_shown") r.askShown += Number(e.n);
    else if (e.event === "ask_shop") r.askShop += Number(e.n);
  }
  return [...rows.values()].sort(
    (a, b) => b.resultsVisitors - a.resultsVisitors || a.subcategoryId.localeCompare(b.subcategoryId),
  );
}

export const UI_EVENT_RETENTION_DAYS = 90;

/** Housekeeping: button events are kept 90 days, like ad landings. */
export async function purgeUiEvents(db: Db, now = new Date()): Promise<number> {
  const cutoff = rigaDay(new Date(now.getTime() - UI_EVENT_RETENTION_DAYS * 86_400_000));
  const rows = await db.delete(uiEvents).where(lt(uiEvents.day, cutoff)).returning({ id: uiEvents.id });
  return rows.length;
}
