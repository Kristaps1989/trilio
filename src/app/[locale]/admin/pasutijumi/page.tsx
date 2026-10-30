import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { applyFilters, parseFilters } from "@/domain/admin/crm";
import { formatEur } from "@/i18n/format";
import { workItems } from "@/services/admin/crm";
import { buttonClass } from "@/ui/Button";
import { requireAdmin } from "../guard";
import {
  FilterBar,
  NextStepCell,
  PartnerChip,
  Pager,
  ProductCell,
  StageCell,
  StateViews,
  WaitCell,
  csvHref,
} from "../crm";
import { AdminTitle, Table } from "../ui";

// Pasūtījumi (docs/CRM_PLAN.md §3.2): every order with its number, the
// product's model code and EAN, the buyer, the amount, the stage, the partner
// mark with the partner's order number, the date and the next step.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pasūtījumi" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminOrders({ searchParams }: Props) {
  await requireAdmin("/admin/pasutijumi");
  const t = await getTranslations("admin.orders");
  const tc = await getTranslations("admin.crm");
  const filters = { ...parseFilters(await searchParams, { state: "all" }), kind: "order" as const };
  const now = new Date();
  const { rows, total, counts, hasMore } = applyFilters(await workItems(db, now, ["order"]), filters, now);
  const base = "/admin/pasutijumi";
  return (
    <>
      <AdminTitle title={t("title")}>
        <a href="/admin/pasutijumi/csv" download className={buttonClass({ variant: "outline", size: "sm" })}>
          {t("csv")}
        </a>
      </AdminTitle>
      <StateViews filters={filters} counts={counts} basePath={base} />
      <FilterBar filters={filters} basePath={base} csvHref={csvHref(filters)} />
      <Table
        caption={t("title")}
        head={[
          tc("col.product"),
          tc("col.person"),
          tc("col.amount"),
          tc("col.stage"),
          tc("col.partner"),
          tc("col.date"),
          tc("col.next"),
        ]}
        empty={tc("empty")}
        rows={rows.map((item) => [
          <ProductCell key="p" item={item} />,
          item.person ?? "—",
          item.amountCents !== null ? formatEur(item.amountCents) : "—",
          <StageCell key="st" item={item} />,
          <PartnerChip key="pa" partner={item.partner} />,
          <WaitCell key="w" item={item} now={now} />,
          <NextStepCell key="n" item={item} />,
        ])}
      />
      <Pager filters={filters} basePath={base} total={total} shown={rows.length} hasMore={hasMore} />
    </>
  );
}
