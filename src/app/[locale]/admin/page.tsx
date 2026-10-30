import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { applyFilters, parseFilters } from "@/domain/admin/crm";
import { formatEur, formatInt } from "@/i18n/format";
import { workItems } from "@/services/admin/crm";
import { headline, todayTodo } from "@/services/admin/stats";
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
} from "./crm";
import { AdminTitle, Section, Stat, Stats, Table } from "./ui";
import { requireAdmin } from "./guard";

// Uzdevumi (docs/CRM_PLAN.md §3.1): leads, offers and orders in one list,
// Trilio's turn first and the longest-waiting at the top, no time limits. The
// filters live in the URL, so every view can be bookmarked. Šodien is a view
// here ("Periods: Šodien"), and the day's numbers stay at the bottom.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Uzdevumi" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminTasks({ searchParams }: Props) {
  await requireAdmin();
  const t = await getTranslations("admin.crm");
  const tt = await getTranslations("admin.today");
  const filters = parseFilters(await searchParams, { state: "action", sort: "waiting" });
  const now = new Date();
  const [items, todo, numbers] = await Promise.all([
    workItems(db, now),
    todayTodo(db, now),
    headline(db, now),
  ]);
  const { rows, total, counts, hasMore } = applyFilters(items, filters, now);
  const alerts = todo.filter((i) => i.kind === "ingestion");

  return (
    <>
      <AdminTitle title={t("title")} sub={t("sub", { count: counts.action })} />
      {alerts.length ? (
        <Section title={t("alerts")} id="alerts">
          <ul className="flex flex-col gap-2">
            {alerts.map((a) => (
              <li key={a.id}>
                <Link
                  href={a.href}
                  className="flex min-h-12 flex-wrap items-center gap-x-3 rounded-panel-lg border-[1.5px] border-warning px-4 py-2 text-mist"
                >
                  <span className="font-semibold">{tt(`kind.${a.kind}`)}</span>
                  <span>{a.title}</span>
                  <span className="text-sm text-stone">{a.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <StateViews filters={filters} counts={counts} basePath="/admin" />
      <FilterBar filters={filters} basePath="/admin" showKind csvHref={csvHref(filters)} />
      <Table
        caption={t("title")}
        head={[
          t("col.kind"),
          t("col.product"),
          t("col.person"),
          t("col.amount"),
          t("col.stage"),
          t("col.partner"),
          t("col.date"),
          t("col.next"),
        ]}
        empty={t("empty")}
        rows={rows.map((item) => [
          <span key="k" className="text-sm font-semibold text-lime">
            {t(`kindLabel.${item.kind}`)}
          </span>,
          <ProductCell key="p" item={item} />,
          item.kind === "lead" && item.savers ? (
            <span key="s" className="text-sm">
              {t("savers", { total: item.savers.total, optedIn: item.savers.optedIn })}
            </span>
          ) : (
            (item.person ?? "—")
          ),
          item.amountCents !== null ? formatEur(item.amountCents) : "—",
          <StageCell key="st" item={item} />,
          <PartnerChip key="pa" partner={item.partner} />,
          <WaitCell key="w" item={item} now={now} />,
          <NextStepCell key="n" item={item} />,
        ])}
      />
      <Pager filters={filters} basePath="/admin" total={total} shown={rows.length} hasMore={hasMore} />

      <Section title={t("numbersTitle")} id="numbers">
        <Stats>
          <Stat label={tt("visitors")} value={formatInt(numbers.visitors)} />
          <Stat label={tt("searches")} value={formatInt(numbers.searches)} />
          <Stat
            label={tt("paidMonth")}
            value={formatInt(numbers.offersPaidMonth)}
            hint={tt("sentMonth", { count: numbers.offersSentMonth })}
          />
          <Stat
            label={tt("ratio")}
            value={numbers.paidRatio === null ? "—" : `${numbers.paidRatio}%`}
            hint={tt("ratioHint")}
          />
          <Stat
            label={tt("revenue")}
            value={formatEur(numbers.revenueMonthCents)}
            hint={tt("margin", { amount: formatEur(numbers.marginMonthCents) })}
          />
        </Stats>
      </Section>
    </>
  );
}
