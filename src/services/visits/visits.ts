import { randomBytes } from "node:crypto";
import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { affiliateClicks, botHits, visitSalts, visits } from "@/db/schema";
import { clickSuspicion, type ClickSignals } from "@/domain/analytics/click-quality";
import { cleanVisitor } from "./suspects";
import { recordHouseholdVisit } from "@/services/growth/tv";
import type { ClickSource } from "@/domain/analytics/click-source";
import { clientFamily, RAW_RETENTION_DAYS, rigaDay, visitOf, visitorHash } from "@/domain/analytics/visits";

// Counting and rolling up first-party page views (docs/ADMIN_AND_OFFERS_PLAN.md §3).
// One random salt per day lives in the database so every instance hashes
// alike; salts older than yesterday are deleted by the daily rollup.

export async function saltFor(db: Db, day: string): Promise<string> {
  const fresh = randomBytes(24).toString("base64url");
  await db.insert(visitSalts).values({ day, salt: fresh }).onConflictDoNothing();
  const [row] = await db
    .select({ salt: visitSalts.salt })
    .from(visitSalts)
    .where(sql`${visitSalts.day} = ${day}`);
  return row?.salt ?? fresh;
}

export async function recordVisit(
  db: Db,
  input: {
    path: string;
    ip: string;
    userAgent: string | null;
    now?: Date;
    /** Why the beacon does not look like a person's (requestSuspicion), or "internal" for an admin's own browsing. */
    suspect?: string | null;
  },
): Promise<boolean> {
  const info = visitOf(input.path, input.userAgent);
  if (!info) return false;
  const now = input.now ?? new Date();
  const day = rigaDay(now);
  const salt = await saltFor(db, day);
  const hash = visitorHash(salt, input.ip, input.userAgent ?? "");
  await db.insert(visits).values({
    day,
    path: info.path,
    section: info.section,
    subcategory: info.subcategory ?? null,
    visitorHash: hash,
    client: clientFamily(input.userAgent),
    suspect: input.suspect ?? null,
  });
  // A person's view, as a household for a running TV campaign (docs/TV_PIXEL_BEST_PRACTICE.md §2.2).
  if (!input.suspect)
    await recordHouseholdVisit(db, { ip: input.ip, visitorHash: hash, day, now }).catch((err) =>
      console.error("tv household visit:", (err as Error).message),
    );
  return true;
}

export type BotKind = "visit" | "search" | "click";

/** One request recognised as a bot and left out of the statistics (shown as "Filtrēti roboti"). */
export async function countBot(db: Db, kind: BotKind, now = new Date()): Promise<void> {
  await db
    .insert(botHits)
    .values({ day: rigaDay(now), kind, hits: 1 })
    .onConflictDoUpdate({ target: [botHits.day, botHits.kind], set: { hits: sql`${botHits.hits} + 1` } });
}

/** Bot requests left out per kind between two Riga days, inclusive. */
export async function botStats(db: Db, from: string, to: string): Promise<Record<BotKind, number>> {
  const rows = await db
    .select({ kind: botHits.kind, hits: sql<number>`sum(${botHits.hits})::int` })
    .from(botHits)
    .where(and(gte(botHits.day, from), lte(botHits.day, to)))
    .groupBy(botHits.kind);
  const out: Record<BotKind, number> = { visit: 0, search: 0, click: 0 };
  for (const r of rows) if (r.kind in out) out[r.kind as BotKind] = Number(r.hits);
  return out;
}

/** Visitors per browser family between two Riga days (raw visits: the last 35 days). */
export async function clientStats(db: Db, from: string, to: string) {
  const rows = await db
    .select({
      client: sql<string>`coalesce(${visits.client}, '—')`,
      visitors: sql<number>`count(distinct ${visits.visitorHash} || ${visits.day})::int`,
      views: sql<number>`count(*)::int`,
    })
    .from(visits)
    .where(and(gte(visits.day, from), lte(visits.day, to), cleanVisitor(visits.day, visits.visitorHash)))
    .groupBy(sql`coalesce(${visits.client}, '—')`);
  return rows
    .map((r) => ({ client: r.client, visitors: Number(r.visitors), views: Number(r.views) }))
    .sort((a, b) => b.visitors - a.visitors || a.client.localeCompare(b.client));
}

/** A visitor's repeat click on the same product within this window counts once. */
export const CLICK_DEDUP_MS = 30 * 60_000;

/** Whether this visitor hash sent a page view that day (the beacon needs JavaScript and a visible page). */
export async function pageViewed(db: Db, hash: string, day: string): Promise<boolean> {
  const [row] = await db
    .select({ id: visits.id })
    .from(visits)
    .where(and(eq(visits.visitorHash, hash), sql`${visits.day} = ${day}`))
    .limit(1);
  return !!row;
}

/**
 * Records a click through to a shop, unless the same visitor (the day's
 * anonymous hash) clicked the same offer in the last 30 minutes; such a
 * repeat still credits the earlier click with an ad visit it lacked. Returns
 * whether it was counted. Bots are filtered by the caller.
 */
export async function recordShopClick(
  db: Db,
  input: {
    offerId: string;
    ip: string;
    userAgent: string | null;
    searchSessionId: string | null;
    adLandingId: string | null;
    /** Which link it came from (domain/analytics/click-source). */
    source?: ClickSource | null;
    /** The request's own metadata (domain/analytics/click-quality); with it the click is judged person or suspect. */
    signals?: ClickSignals | null;
    /** An admin's own click. */
    internal?: boolean;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const hash = visitorHash(await saltFor(db, rigaDay(now)), input.ip, input.userAgent ?? "");
  const [recent] = await db
    .select({ id: affiliateClicks.id, adLandingId: affiliateClicks.adLandingId })
    .from(affiliateClicks)
    .where(
      and(
        eq(affiliateClicks.visitorHash, hash),
        eq(affiliateClicks.offerId, input.offerId),
        gte(affiliateClicks.clickedAt, new Date(now.getTime() - CLICK_DEDUP_MS)),
      ),
    )
    .limit(1);
  if (recent) {
    // Not counted again, but an ad visit recorded since the first click is credited to it.
    if (!recent.adLandingId && input.adLandingId)
      await db
        .update(affiliateClicks)
        .set({ adLandingId: input.adLandingId })
        .where(eq(affiliateClicks.id, recent.id));
    return false;
  }
  // A click that does not look like a person on a Trilio page is kept, marked, and left out of every figure.
  const suspect = input.signals
    ? clickSuspicion({
        userAgent: input.userAgent,
        signals: input.signals,
        source: input.source ?? null,
        pageViewed: await pageViewed(db, hash, rigaDay(now)),
      })
    : null;
  await db.insert(affiliateClicks).values({
    signals: input.signals ?? null,
    suspect,
    offerId: input.offerId,
    searchSessionId: input.searchSessionId,
    adLandingId: input.adLandingId,
    visitorHash: hash,
    source: input.source ?? null,
    internal: input.internal ?? false,
    client: clientFamily(input.userAgent),
    clickedAt: now,
  });
  return true;
}

/**
 * Folds finished days into visit_daily (idempotent: a day is recomputed in
 * full), then deletes raw rows past the retention and salts older than yesterday.
 */
export async function rollupVisits(db: Db, now = new Date()): Promise<{ days: number; purged: number }> {
  const today = rigaDay(now);
  const yesterday = rigaDay(new Date(now.getTime() - 24 * 3600 * 1000));
  // A day still in the raw visits is rebuilt in full: a path whose every view turned out
  // to be a left-out visitor's must lose its old row, not keep it.
  await db.execute(
    sql`delete from visit_daily where day in (select distinct day from visits where day < ${today})`,
  );
  const rolled = await db.execute(sql`
    insert into visit_daily (day, path, section, subcategory, views, visitors)
    select v.day, v.path, min(v.section), min(v.subcategory), count(*)::int, count(distinct v.visitor_hash)::int
    from visits v where v.day < ${today} and ${cleanVisitor(sql`v.day`, sql`v.visitor_hash`)}
    group by v.day, v.path
    on conflict (day, path) do update set views = excluded.views, visitors = excluded.visitors,
      section = excluded.section, subcategory = excluded.subcategory
    returning day`);
  const cutoff = rigaDay(new Date(now.getTime() - RAW_RETENTION_DAYS * 24 * 3600 * 1000));
  const purged = await db.delete(visits).where(lt(visits.day, cutoff)).returning({ id: visits.id });
  await db.delete(visitSalts).where(and(lt(visitSalts.day, yesterday)));
  const days = new Set((rolled as unknown as { day: string }[]).map((r) => String(r.day)));
  return { days: days.size, purged: purged.length };
}

export type VisitRow = {
  day: string;
  path: string;
  section: string;
  subcategory: string | null;
  views: number;
  visitors: number;
};

/** Per day and path between two Riga days (inclusive): finished days from visit_daily, today live. */
export async function visitRows(db: Db, from: string, to: string, now = new Date()): Promise<VisitRow[]> {
  const today = rigaDay(now);
  const result = await db.execute(sql`
    select to_char(day, 'YYYY-MM-DD') as day, path, section, subcategory, views, visitors
      from visit_daily where day between ${from} and ${to} and day < ${today}
    union all
    select to_char(v.day, 'YYYY-MM-DD'), v.path, min(v.section), min(v.subcategory), count(*)::int,
           count(distinct v.visitor_hash)::int
      from visits v where v.day = ${today} and v.day between ${from} and ${to}
        and ${cleanVisitor(sql`v.day`, sql`v.visitor_hash`)}
      group by v.day, v.path`);
  const rows = [...(result as unknown as VisitRow[])];
  return rows.map((r) => ({ ...r, views: Number(r.views), visitors: Number(r.visitors) }));
}
