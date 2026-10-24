import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, invoices, offerOrders } from "@/db";
import { toCsv } from "@/domain/admin/stats";
import { adminOrNull } from "../../guard";

// The sales ledger for the accountant: every invoice and credit note in order.

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await adminOrNull())) return new NextResponse(null, { status: 404 });
  const rows = await db
    .select({ invoice: invoices, order: offerOrders })
    .from(invoices)
    .innerJoin(offerOrders, eq(offerOrders.id, invoices.orderId))
    .orderBy(invoices.year, invoices.seq);
  const body = toCsv(
    [
      "number",
      "kind",
      "issued",
      "order",
      "buyer_kind",
      "buyer",
      "buyer_reg_no",
      "buyer_vat_no",
      "buyer_address",
      "net_eur",
      "vat_eur",
      "total_eur",
      "vat_rate",
    ],
    rows.map(({ invoice: i, order }) => [
      i.number,
      i.kind,
      i.issuedAt.toISOString().slice(0, 10),
      order.number,
      i.buyer.kind ?? "",
      i.buyer.name ?? "",
      i.buyer.regNo ?? "",
      i.buyer.vatNo ?? "",
      i.buyer.address ?? "",
      i.netCents / 100,
      i.vatCents / 100,
      i.totalCents / 100,
      i.vatRate ?? "",
    ]),
  );
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="trilio-rekini.csv"',
      "cache-control": "no-store",
    },
  });
}
