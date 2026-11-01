import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { change, parseRange, rangeDays, RANGES } from "@/domain/admin/stats";
import { getSubcategory } from "@/domain/questions/catalog";
import { formatEur, formatInt } from "@/i18n/format";
import { confidenceStats, searchStats, shopStats, visitStats } from "@/services/admin/stats";
import { notifyFunnel } from "@/services/notify/events";
import { botStats, clientStats } from "@/services/visits/visits";
import { buttonClass } from "@/ui/Button";
import { requireAdmin } from "../guard";
import { AdminTitle, DayBars, FilterLinks, Section, Stat, Stats, Table } from "../ui";

// Statistika (docs/ADMIN_AND_OFFERS_PLAN.md §4): Trilio's own cookie-less
// counts (every visitor), searches with budgets and answers (what people
// want and plan to pay: the sourcing signal), and clicks to shops.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Statistika" };

type Props = { searchParams: Promise<{ periods?: string }> };

export default async function AdminStats({ searchParams }: Props) {
  await requireAdmin("/admin/statistika");
  const t = await getTranslations("admin.stats");
  const range = parseRange((await searchParams).periods);
  const r = rangeDays(range, new Date());
  const [visits, prevVisits, searches, prevSearches, shops, confidence, bots, clients, funnel] =
    await Promise.all([
      visitStats(db, r.from, r.to),
      visitStats(db, r.prevFrom, r.prevTo),
      searchStats(db, r.from, r.to),
      searchStats(db, r.prevFrom, r.prevTo),
      shopStats(db, r.from, r.to),
      confidenceStats(db, r.from, r.to),
      botStats(db, r.from, r.to),
      clientStats(db, r.from, r.to),
      notifyFunnel(db, r.from, r.to),
    ]);
  const funnelTotal = funnel.reduce(
    (a, f) => ({
      results: a.results + f.resultsVisitors,
      taps: a.taps + f.taps,
      sent: a.sent + f.sent,
      confirmed: a.confirmed + f.confirmed,
      askShown: a.askShown + f.askShown,
      askShop: a.askShop + f.askShop,
    }),
    { results: 0, taps: 0, sent: 0, confirmed: 0, askShown: 0, askShop: 0 },
  );
  const share = (n: number, of: number) => (of ? `${formatInt(Math.round((n / of) * 100))} %` : "—");
  const botTotal = bots.visit + bots.search + bots.click;
  const clicks = shops.reduce((n, s) => n + s.clicks, 0);
  const pct = (x: number | null) => (x === null ? "—" : `${formatInt(Math.round(x * 100))} %`);
  const label = (sub: string) => getSubcategory(sub)?.label ?? sub;
  const csv = (table: string) => `/admin/statistika/csv?table=${table}&periods=${range}`;
  const csvLink = (table: string) => (
    <a href={csv(table)} className={buttonClass({ variant: "outline", size: "sm" })} download>
      {t("csv")}
    </a>
  );

  return (
    <>
      <AdminTitle title={t("title")} sub={t("sub", { from: r.from, to: r.to })}>
        <FilterLinks
          label={t("period")}
          items={RANGES.map((k) => ({
            href: `/admin/statistika?periods=${k}`,
            label: t(`range.${k}`),
            active: k === range,
          }))}
        />
      </AdminTitle>

      <Stats>
        <Stat
          label={t("visitors")}
          value={formatInt(visits.total.visitors)}
          delta={change(visits.total.visitors, prevVisits.total.visitors)}
        />
        <Stat
          label={t("views")}
          value={formatInt(visits.total.views)}
          delta={change(visits.total.views, prevVisits.total.views)}
        />
        <Stat
          label={t("searches")}
          value={formatInt(searches.total)}
          delta={change(searches.total, prevSearches.total)}
        />
        <Stat label={t("clicks")} value={formatInt(clicks)} />
        <Stat
          label={t("bots")}
          value={formatInt(botTotal)}
          hint={t("botsHint", { visits: bots.visit, searches: bots.search, clicks: bots.click })}
        />
      </Stats>
      <p
        className="text-sm text-stone"
        data-bot-hits={`${bots.visit}/${bots.search}/${bots.click}`}
        data-shop-clicks={clicks}
        data-searches={searches.total}
      >
        {t("method")} {t("botsMethod")}
      </p>

      {r.days > 1 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <DayBars
            title={t("visitorsPerDay")}
            unit={t("visitorsUnit")}
            points={visits.days.map((d) => ({ day: d.day, value: d.visitors }))}
          />
          <DayBars
            title={t("searchesPerDay")}
            unit={t("searchesUnit")}
            points={searches.days.map((d) => ({ day: d.day, value: d.searches }))}
          />
        </div>
      ) : null}

      {/* docs/PRICE_NOTIFY_PLAN.md §5 PR 3: where "Pieprasīt labāku cenu" loses people. */}
      <Section title={t("notifyFunnel")} id="notify-funnel">
        <Stats>
          <Stat label={t("funnelResults")} value={formatInt(funnelTotal.results)} />
          <Stat label={t("funnelTaps")} value={formatInt(funnelTotal.taps)} />
          <Stat label={t("funnelSent")} value={formatInt(funnelTotal.sent)} />
          <Stat label={t("funnelConfirmed")} value={formatInt(funnelTotal.confirmed)} />
          <Stat label={t("funnelAskShown")} value={formatInt(funnelTotal.askShown)} />
          <Stat label={t("funnelAskShop")} value={formatInt(funnelTotal.askShop)} />
        </Stats>
        <Table
          caption={t("notifyFunnel")}
          head={[
            t("category"),
            t("funnelResults"),
            t("funnelAds"),
            t("funnelTaps"),
            t("funnelSent"),
            t("funnelConfirmed"),
            t("funnelAskShown"),
            t("funnelAskShop"),
          ]}
          empty={t("empty")}
          rows={funnel.map((f) => [
            label(f.subcategoryId),
            formatInt(f.resultsVisitors),
            formatInt(f.adVisitors),
            `${formatInt(f.taps)} (${share(f.taps, f.resultsVisitors)})`,
            formatInt(f.sent),
            formatInt(f.confirmed),
            formatInt(f.askShown),
            `${formatInt(f.askShop)} (${share(f.askShop, f.askShown)})`,
          ])}
        />
        <p className="text-sm text-stone">{t("funnelMethod")}</p>
      </Section>

      {/* docs/CONFIDENCE_PLAN.md §3 E: did the three options end the search? */}
      <Section title={t("confidence")} id="confidence">
        <Stats>
          <Stat label={t("resultViews")} value={formatInt(confidence.views)} />
          <Stat label={t("clickShare")} value={pct(confidence.clickShare)} />
          <Stat label={t("confidentShare")} value={pct(confidence.yesShare)} />
          <Stat label={t("confidenceAnswers")} value={formatInt(confidence.yes + confidence.no)} />
        </Stats>
        <p className="text-sm text-stone">{t("confidenceMethod")}</p>
        <Table
          caption={t("confidenceNotes")}
          head={[t("category"), t("confidenceNote")]}
          empty={t("empty")}
          rows={confidence.notes.map((n) => [label(n.subcategoryId), n.note ?? ""])}
        />
      </Section>

      <Section title={t("sections")} id="sections" action={csvLink("sections")}>
        <Table
          caption={t("sections")}
          head={[t("section"), t("views"), t("visitors")]}
          empty={t("empty")}
          rows={visits.sections.map((s) => [
            t.has(`sectionName.${s.key}`) ? t(`sectionName.${s.key}`) : s.key,
            formatInt(s.views),
            formatInt(s.visitors),
          ])}
        />
      </Section>

      <Section title={t("clients")} id="clients">
        <Table
          caption={t("clients")}
          head={[t("client"), t("visitors"), t("views")]}
          empty={t("empty")}
          rows={clients.slice(0, 15).map((c) => [c.client, formatInt(c.visitors), formatInt(c.views)])}
        />
        <p className="text-sm text-stone">{t("clientsMethod")}</p>
      </Section>

      <Section title={t("paths")} id="paths" action={csvLink("paths")}>
        <Table
          caption={t("paths")}
          head={[t("path"), t("views"), t("visitors")]}
          empty={t("empty")}
          rows={visits.paths.slice(0, 25).map((p) => [
            <code key="p" className="break-all">
              {p.key}
            </code>,
            formatInt(p.views),
            formatInt(p.visitors),
          ])}
        />
      </Section>

      <Section title={t("categories")} id="categories" action={csvLink("categories")}>
        <Table
          caption={t("categories")}
          head={[t("category"), t("searches"), t("budget"), t("topAnswers")]}
          empty={t("empty")}
          rows={searches.subcategories.map((s) => [
            label(s.subcategoryId),
            formatInt(s.searches),
            s.budget
              ? t("budgetRange", {
                  median: formatEur(s.budget.median),
                  q1: formatEur(s.budget.q1),
                  q3: formatEur(s.budget.q3),
                  n: s.withBudget,
                })
              : "—",
            <ul key="a" className="flex flex-col gap-0.5 text-sm text-stone">
              {s.answers.slice(0, 3).map((a) => (
                <li key={a.question}>
                  <span className="text-mist">{a.question}</span>:{" "}
                  {a.options.map((o) => `${o.option} (${o.count})`).join(", ")}
                </li>
              ))}
            </ul>,
          ])}
        />
      </Section>

      <Section title={t("shops")} id="shops" action={csvLink("shops")}>
        <Table
          caption={t("shops")}
          head={[t("shop"), t("clicks")]}
          empty={t("empty")}
          rows={shops.map((s) => [s.store, formatInt(s.clicks)])}
        />
      </Section>
    </>
  );
}
