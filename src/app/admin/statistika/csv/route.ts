import { NextResponse } from "next/server";
import { db } from "@/db";
import { parseRange, rangeDays, toCsv } from "@/domain/admin/stats";
import { searchStats, shopStats, visitStats } from "@/services/admin/stats";
import { adminOrNull } from "../../guard";

// "Lejupielādēt CSV" for every Statistika table.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await adminOrNull())) return new NextResponse(null, { status: 404 });
  const url = new URL(request.url);
  const range = parseRange(url.searchParams.get("periods") ?? undefined);
  const r = rangeDays(range, new Date());
  const table = url.searchParams.get("table");
  let body: string;
  if (table === "sections" || table === "paths") {
    const v = await visitStats(db, r.from, r.to);
    const list = table === "sections" ? v.sections : v.paths;
    body = toCsv(
      [table === "sections" ? "section" : "path", "views", "visitors"],
      list.map((x) => [x.key, x.views, x.visitors]),
    );
  } else if (table === "categories") {
    const s = await searchStats(db, r.from, r.to);
    body = toCsv(
      ["subcategory", "searches", "with_budget", "budget_q1_eur", "budget_median_eur", "budget_q3_eur"],
      s.subcategories.map((c) => [
        c.subcategoryId,
        c.searches,
        c.withBudget,
        c.budget ? c.budget.q1 / 100 : null,
        c.budget ? c.budget.median / 100 : null,
        c.budget ? c.budget.q3 / 100 : null,
      ]),
    );
  } else if (table === "shops") {
    body = toCsv(
      ["shop", "clicks"],
      (await shopStats(db, r.from, r.to)).map((s) => [s.store, s.clicks]),
    );
  } else return new NextResponse(null, { status: 404 });
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="trilio-${table}-${r.from}-${r.to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
