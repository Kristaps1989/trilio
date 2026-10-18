import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";

// Public data-freshness check: per active store, how many offers are in stock
// and when the ingest cron service last ran (docs/DEPLOY_RAILWAY.md §5).
// Counts and timestamps only, no error text, so nothing internal leaks.

export const dynamic = "force-dynamic";

type Row = {
  slug: string;
  offers_in_stock: number;
  last_run_started: string | null;
  last_run_finished: string | null;
  last_run_ok: boolean | null;
  last_run_upserted: number | null;
};

export async function GET() {
  try {
    const rows = (await db.execute(sql`
      select s.slug,
        (select count(*)::int from offers o where o.store_id = s.id and o.stock <> 'out') as offers_in_stock,
        r.started_at as last_run_started, r.finished_at as last_run_finished,
        r.ok as last_run_ok, r.rows_upserted as last_run_upserted
      from stores s
      left join lateral (
        select * from ingestion_runs ir where ir.store_id = s.id order by ir.started_at desc limit 1
      ) r on true
      where s.active
      order by s.slug
    `)) as unknown as Row[];
    const stores = rows.map((r) => ({
      slug: r.slug,
      offersInStock: r.offers_in_stock,
      lastRun: r.last_run_started
        ? {
            startedAt: r.last_run_started,
            finishedAt: r.last_run_finished,
            ok: r.last_run_ok,
            rowsUpserted: r.last_run_upserted,
          }
        : null,
    }));
    return NextResponse.json(
      {
        offersInStock: stores.reduce((n, s) => n + s.offersInStock, 0),
        ingestHasRun: stores.some((s) => s.lastRun !== null),
        stores,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "database unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
