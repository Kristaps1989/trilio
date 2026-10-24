import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { formatEur, formatInt } from "@/i18n/format";
import { headline, todayTodo, type TodoItem } from "@/services/admin/stats";
import { AdminTitle, Section, Stat, Stats } from "./ui";
import { requireAdmin } from "./guard";

// "Šodien" (docs/ADMIN_AND_OFFERS_PLAN.md §11.9): what needs a hand, as a list
// that empties, then the day's numbers. Charts live under Statistika.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Šodien" };

const ORDER: TodoItem["kind"][] = ["problem", "late", "ship", "return", "unpaid", "expiring", "ingestion"];

export default async function AdminToday() {
  await requireAdmin();
  const t = await getTranslations("admin.today");
  const [todo, numbers] = await Promise.all([todayTodo(db), headline(db)]);
  const sorted = [...todo].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

  return (
    <>
      <AdminTitle title={t("title")} sub={todo.length ? t("count", { count: todo.length }) : t("allDone")} />
      {sorted.length ? (
        <Section title={t("todoTitle")} id="todo">
          <ul className="flex flex-col gap-2">
            {sorted.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <Link
                  href={item.href}
                  className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-panel-lg border-[1.5px] border-line-25 px-4 py-3 text-mist hover:border-lime"
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-bold text-lime">{t(`kind.${item.kind}`)}</span>
                    <span className="text-[16px] font-semibold">{item.title}</span>
                  </span>
                  {item.detail && item.kind !== "expiring" ? (
                    <span className="max-w-full truncate text-sm text-stone">{item.detail}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title={t("numbersTitle")} id="numbers">
        <Stats>
          <Stat label={t("visitors")} value={formatInt(numbers.visitors)} />
          <Stat label={t("searches")} value={formatInt(numbers.searches)} />
          <Stat
            label={t("paidMonth")}
            value={formatInt(numbers.offersPaidMonth)}
            hint={t("sentMonth", { count: numbers.offersSentMonth })}
          />
          <Stat
            label={t("ratio")}
            value={numbers.paidRatio === null ? "—" : `${numbers.paidRatio}%`}
            hint={t("ratioHint")}
          />
          <Stat
            label={t("revenue")}
            value={formatEur(numbers.revenueMonthCents)}
            hint={t("margin", { amount: formatEur(numbers.marginMonthCents) })}
          />
        </Stats>
      </Section>
    </>
  );
}
