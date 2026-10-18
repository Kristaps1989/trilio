import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { attributeCatalog } from "@/domain/catalog/attributes";

// Public data-freshness check: per active store, how many offers are in stock
// and when it was last read (docs/DEPLOY_RAILWAY.md §5); per subcategory, the
// share of in-stock products that have each fit-critical attribute
// (docs/FILTERS_PLAN.md §1.5). Counts and timestamps only, so nothing internal leaks.

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
    const coverage = await attributeCoverage();
    return NextResponse.json(
      {
        offersInStock: stores.reduce((n, s) => n + s.offersInStock, 0),
        ingestHasRun: stores.some((s) => s.lastRun !== null),
        stores,
        coverage,
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

type CoverageRow = { subcategory_id: string; products: number; key: string | null; with_key: number };

/** Per subcategory: in-stock products and the percentage that state each fit-critical attribute. */
async function attributeCoverage() {
  const rows = (await db.execute(sql`
    with live as (
      select distinct p.id, p.subcategory_id, p.attributes
      from products p join offers o on o.product_id = p.id
      join stores s on s.id = o.store_id
      where o.stock <> 'out' and s.active and s.feed_type <> 'sample'
    )
    select l.subcategory_id, (select count(*)::int from live x where x.subcategory_id = l.subcategory_id) as products,
           k.key, count(*)::int as with_key
    from live l left join lateral jsonb_object_keys(l.attributes) as k(key) on true
    group by l.subcategory_id, k.key
  `)) as unknown as CoverageRow[];
  const out: Record<string, { products: number; fit: Record<string, number> }> = {};
  for (const [sub, def] of Object.entries(attributeCatalog.subcategories)) {
    const forSub = rows.filter((r) => r.subcategory_id === sub);
    const total = forSub[0]?.products ?? 0;
    if (total === 0) continue;
    const fit: Record<string, number> = {};
    for (const key of def.fit) {
      const n = forSub.find((r) => r.key === key)?.with_key ?? 0;
      fit[key] = Math.round((n / total) * 100);
    }
    out[sub] = { products: total, fit };
  }
  return out;
}
