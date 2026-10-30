import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { applyFilters, parseFilters, PAGE_SIZE, type WorkItem } from "@/domain/admin/crm";
import { toCsv } from "@/domain/admin/stats";
import { workItems } from "@/services/admin/crm";
import { adminOrNull } from "../../guard";

// The CSV of exactly the view on screen (docs/CRM_PLAN.md §6), every page of it.

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await adminOrNull())) return new NextResponse(null, { status: 404 });
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filters = parseFilters(sp, { state: "all" });
  const now = new Date();
  const items = await workItems(db, now);
  const rows: WorkItem[] = [];
  for (let page = 1; ; page++) {
    const r = applyFilters(items, { ...filters, page }, now);
    rows.push(...r.rows);
    if (!r.hasMore || page * PAGE_SIZE > 100_000) break;
  }
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const body = toCsv(
    [
      "kind",
      "number",
      "product",
      "model_code",
      "ean",
      "category",
      "person",
      "amount_eur",
      "stage",
      "state",
      "next_step",
      "date",
      "waiting_since",
      "partner_status",
      "partner",
      "partner_order",
      "savers",
    ],
    rows.map((i) => [
      i.kind,
      i.number ?? "",
      i.product.name,
      i.product.modelCode ?? "",
      i.product.ean ?? "",
      i.product.subcategoryId,
      i.person ?? "",
      i.amountCents !== null ? (i.amountCents / 100).toFixed(2) : "",
      i.stage,
      i.state,
      i.next ?? "",
      day(i.date),
      day(i.waitingSince),
      i.partner?.status ?? "",
      i.partner?.partner ?? "",
      i.partner?.ref ?? "",
      i.savers?.total ?? "",
    ]),
  );
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="trilio-uzdevumi-${now.toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
