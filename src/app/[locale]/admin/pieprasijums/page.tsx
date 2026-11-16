import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { applyFilters, parseFilters } from "@/domain/admin/crm";
import { formatEur } from "@/i18n/format";
import { leadPrices, workItems } from "@/services/admin/crm";
import Link from "next/link";
import { Button, ButtonLink } from "@/ui/Button";
import { bulkLeadsAction } from "../outcome-actions";
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
  const sp = (await searchParams) as Record<string, string | undefined>;
  const filters = { ...parseFilters(sp, { state: "all" }), kind: "lead" as const };
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
      {sp.bulk ? (
        <p
          role="status"
          className="rounded-panel-lg bg-lime px-4 py-3 text-[15px] font-semibold text-night"
          data-bulk-done={sp.bulk}
        >
          {t(`bulkDone.${sp.bulk === "nothing" ? "nothing" : "monitoring"}`, {
            count: Number(sp.marked ?? 0),
          })}
        </p>
      ) : null}
      <StateViews filters={filters} counts={counts} basePath={base} />
      <p className="text-[15px]">
        <Link
          href="/admin?state=action&partner=unavailable&kind=lead"
          className="font-semibold text-mist underline underline-offset-2"
          data-testid="decide-view"
        >
          {t("decideView")}
        </Link>
      </p>
      <FilterBar filters={filters} basePath={base} csvHref={csvHref(filters)} />
      <form id="bulk-leads" action={bulkLeadsAction} />
      <Table
        caption={t("title")}
        head={[
          t("select"),
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
            <label key="c" className="flex min-h-11 min-w-11 items-center justify-center">
              <input
                type="checkbox"
                name="productIds"
                value={item.id}
                form="bulk-leads"
                aria-label={t("selectOne", { name: item.product.name })}
                className="h-5 w-5 accent-lime"
              />
            </label>,
            <ProductCell key="p" item={item} />,
            <span key="s" className="flex flex-col text-sm">
              <span>{tc("savers", { total: s.total, optedIn: s.optedIn })}</span>
              {s.requested ? (
                <span data-lead-requests={s.requested}>
                  {tc("requested", { count: s.requested, ok: s.requestable ?? 0 })}
                </span>
              ) : null}
              <span className="text-stone">{tc("saversDone", { offered: s.offered, bought: s.bought })}</span>
              {s.undecided ? (
                <span className="font-semibold text-warning" data-lead-undecided={s.undecided}>
                  {t("undecided", { count: s.undecided })}
                </span>
              ) : null}
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
      {rows.length ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            form="bulk-leads"
            name="op"
            value="monitoring"
            variant="outline"
            size="sm"
            data-testid="bulk-leads-monitoring"
          >
            {t("bulkMonitoring")}
          </Button>
          <Button
            type="submit"
            form="bulk-leads"
            name="op"
            value="nothing"
            variant="outline"
            size="sm"
            data-testid="bulk-leads-nothing"
          >
            {t("bulkNothing")}
          </Button>
          <span className="text-sm text-stone">{t("bulkHint")}</span>
        </div>
      ) : null}
      <Pager filters={filters} basePath={base} total={total} shown={rows.length} hasMore={hasMore} />
    </>
  );
}
