import { sql, type SQL } from "drizzle-orm";

// Which visitors' days are left out of the statistics (docs/CLICK_QUALITY_PLAN.md §6).
//
// A visitor is the day's anonymous hash (salt, address, user agent). Their
// whole day is left out of visitors, searches, the funnel and the TV figures
// when any of their requests did not look like a person's browser (a page
// view beacon, a results page, a button's call or a shop click without fetch
// metadata), or when it was an admin's own browsing or click. A click judged
// only "not from a page" or "no page view" does not taint the day: a person
// can open a saved link from an e-mail.

/** (day, visitor_hash) of every left-out visitor day. */
export const suspectVisitorDays = sql`(
  select (ac.clicked_at at time zone 'Europe/Riga')::date as day, ac.visitor_hash
    from affiliate_clicks ac
    where ac.visitor_hash is not null and (ac.suspect = 'no_fetch_meta' or ac.internal)
  union
  select sv_v.day, sv_v.visitor_hash from visits sv_v where sv_v.suspect is not null
  union
  select (ss.created_at at time zone 'Europe/Riga')::date, ss.visitor_hash
    from search_sessions ss where ss.suspect is not null and ss.visitor_hash is not null
  union
  select ue.day, ue.visitor_hash from ui_events ue where ue.suspect is not null
)`;

/** A condition: this visitor's day is not left out. `day` is a date, `hash` the day's visitor hash. */
export function cleanVisitor(day: SQL | unknown, hash: SQL | unknown): SQL {
  return sql`not exists (select 1 from ${suspectVisitorDays} sx where sx.day = ${day} and sx.visitor_hash = ${hash})`;
}

/** Distinct left-out visitor days between two Riga days (inclusive), for the "Filtrēti" tile. */
export const suspectVisitorCount = (from: string, to: string) =>
  sql<number>`(select count(*)::int from ${suspectVisitorDays} sc where sc.day between ${from}::date and ${to}::date)`;
