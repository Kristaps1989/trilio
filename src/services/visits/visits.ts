import { randomBytes } from "node:crypto";
import { and, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { visitSalts, visits } from "@/db/schema";
import { RAW_RETENTION_DAYS, rigaDay, visitOf, visitorHash } from "@/domain/analytics/visits";

// Counting and rolling up first-party page views (docs/ADMIN_AND_OFFERS_PLAN.md §3).
// One random salt per day lives in the database so every instance hashes
// alike; salts older than yesterday are deleted by the daily rollup.

async function saltFor(db: Db, day: string): Promise<string> {
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
  input: { path: string; ip: string; userAgent: string | null; now?: Date },
): Promise<boolean> {
  const info = visitOf(input.path, input.userAgent);
  if (!info) return false;
  const day = rigaDay(input.now ?? new Date());
  const salt = await saltFor(db, day);
  await db.insert(visits).values({
    day,
    path: info.path,
    section: info.section,
    subcategory: info.subcategory ?? null,
    visitorHash: visitorHash(salt, input.ip, input.userAgent ?? ""),
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
  const rolled = await db.execute(sql`
    insert into visit_daily (day, path, section, subcategory, views, visitors)
    select day, path, min(section), min(subcategory), count(*)::int, count(distinct visitor_hash)::int
    from visits where day < ${today}
    group by day, path
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
    select to_char(day, 'YYYY-MM-DD'), path, min(section), min(subcategory), count(*)::int,
           count(distinct visitor_hash)::int
      from visits where day = ${today} and day between ${from} and ${to}
      group by day, path`);
  const rows = [...(result as unknown as VisitRow[])];
  return rows.map((r) => ({ ...r, views: Number(r.views), visitors: Number(r.visitors) }));
}
