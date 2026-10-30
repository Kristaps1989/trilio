import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { applyFilters, parseFilters } from "@/domain/admin/crm";
import { formatEur } from "@/i18n/format";
import { workItems } from "@/services/admin/crm";
import { ButtonLink } from "@/ui/Button";
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

// Piedāvājumi (docs/CRM_PLAN.md §3.2): every offer with model code and EAN,
// to whom, the price, its stage, the partner mark, when, and the next step.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Piedāvājumi" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminOffers({ searchParams }: Props) {
  await requireAdmin("/admin/piedavajumi");
  const t = await getTranslations("admin.offers");
  const tc = await getTranslations("admin.crm");
  const sp = await searchParams;
  const filters = { ...parseFilters(sp, { state: "all" }), kind: "offer" as const };
  const now = new Date();
  const { rows, total, counts, hasMore } = applyFilters(await workItems(db, now, ["offer"]), filters, now);
  const base = "/admin/piedavajumi";
  const n = (k: string) => Number(Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) || 0;
  return (
    <>
      <AdminTitle title={t("title")}>
        <ButtonLink href="/admin/piedavajumi/jauns">{t("new")}</ButtonLink>
      </AdminTitle>
      {sp.created ? (
        <p role="status" className="rounded-[14px] bg-lime-12 px-4 py-3 text-mist">
          {t("created", { count: n("created") })}
          {n("skipped") ? ` ${t("skipped", { count: n("skipped") })}` : ""}
          {n("failed") ? ` ${t("failed", { count: n("failed") })}` : ""}
        </p>
      ) : null}
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
