import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { applyFilters, parseFilters } from "@/domain/admin/crm";
import { formatEur } from "@/i18n/format";
import { leadPrices, workItems } from "@/services/admin/crm";
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

// Pieprasījums (docs/CRM_PLAN.md §3.2): products people asked to hear about,
// with model code and EAN, how many saved and how many were offered or bought,
// shop prices, the partner mark, and one tap to offer it to everyone who agreed.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pieprasījums" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminDemand({ searchParams }: Props) {
  await requireAdmin("/admin/pieprasijums");
  const t = await getTranslations("admin.demand");
  const tc = await getTranslations("admin.crm");
  const filters = { ...parseFilters(await searchParams, { state: "all" }), kind: "lead" as const };
  const now = new Date();
  const { rows, total, counts, hasMore } = applyFilters(await workItems(db, now, ["lead"]), filters, now);
  const prices = await leadPrices(
    db,
    rows.map((r) => r.id),
  );
  const base = "/admin/pieprasijums";
  return (
    <>
      <AdminTitle title={t("title")} sub={t("sub")} />
      <StateViews filters={filters} counts={counts} basePath={base} />
      <FilterBar filters={filters} basePath={base} csvHref={csvHref(filters)} />
      <Table
        caption={t("title")}
        head={[
          tc("col.product"),
          tc("col.savers"),
          tc("col.prices"),
          tc("col.stage"),
          tc("col.partner"),
          tc("col.date"),
          tc("col.next"),
        ]}
        empty={tc("empty")}
        rows={rows.map((item) => {
          const p = prices.get(item.id);
          const s = item.savers!;
          return [
            <ProductCell key="p" item={item} />,
            <span key="s" className="flex flex-col text-sm">
              <span>{tc("savers", { total: s.total, optedIn: s.optedIn })}</span>
              <span className="text-stone">{tc("saversDone", { offered: s.offered, bought: s.bought })}</span>
            </span>,
            p?.bestCents != null ? (
              <span key="b" className="flex flex-col">
                <span>
                  {formatEur(p.bestCents)} <span className="text-sm text-stone">{p.bestStore}</span>
                </span>
                {p.low30Cents != null ? (
                  <span className="text-sm text-stone">
                    {tc("low30", { price: formatEur(p.low30Cents) })}
                  </span>
                ) : null}
              </span>
            ) : (
              <span key="b" className="text-sm text-stone">
                {tc("noShop")}
              </span>
            ),
            <StageCell key="st" item={item} />,
            <PartnerChip key="pa" partner={item.partner} />,
            <WaitCell key="w" item={item} now={now} />,
            <span key="n" className="flex flex-col items-start gap-2">
              <NextStepCell item={item} />
              {s.optedIn > 0 ? (
                <ButtonLink
                  href={`/admin/piedavajumi/jauns?product=${item.id}&all=1`}
                  size="sm"
                  variant="outline"
                >
                  {tc("offerAll", { count: s.optedIn })}
                </ButtonLink>
              ) : null}
            </span>,
          ];
        })}
      />
      <Pager filters={filters} basePath={base} total={total} shown={rows.length} hasMore={hasMore} />
    </>
  );
}
