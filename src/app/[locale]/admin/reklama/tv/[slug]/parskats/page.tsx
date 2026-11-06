import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { formatDateShort, formatInt, formatNumber } from "@/i18n/format";
import { tvReport, tvStats } from "@/services/growth/tv";
import { PrintButton } from "@/ui/PrintButton";
import { requireAdmin } from "../../../../guard";
import { corr, num, pct } from "../../Effect";
import { Profile } from "../../Profile";

// The case-study page for Go3 (docs/TV_ANALYTICS_PLAN.md §3): one printable
// page with the campaign's facts, the uplift, the 24-hour profile, brand
// searches and the method. White, so the browser's PDF is the file to send.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "TV kampaņas pārskats" };

type Props = { params: Promise<{ slug: string }> };

const fmtDay = (day: string) => formatDateShort(new Date(`${day}T12:00:00+02:00`));

export default async function TvCaseStudy({ params }: Props) {
  const { slug } = await params;
  await requireAdmin(`/admin/reklama/tv/${slug}/parskats`);
  const t = await getTranslations("admin.ads.tvReport");
  const tt = await getTranslations("admin.ads.tv");
  const report = await tvReport(db, slug);
  if (!report) notFound();
  const stats = (await tvStats(db)).find((c) => c.campaign.slug === slug);
  const s = report.summary;
  const base = report.baseline;
  const hasBase = !!base && base.days > 0;
  const days = [...report.days].reverse();
  const first = days[0]?.day;
  const last = days.at(-1)?.day;
  const sessionsBefore = hasBase ? base.sessions.reduce((a, b) => a + b, 0) : null;
  const sessionsDuring = days.length ? days.reduce((a, d) => a + d.sessionsDay, 0) / days.length : null;

  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-4 border-b border-[#DCE4E1] py-1.5 text-[15px]">
      <span className="text-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
  const stat = (label: string, value: string, hint?: string) => (
    <div className="flex min-w-[150px] flex-1 flex-col gap-0.5 rounded-[14px] border-[1.5px] border-[#DCE4E1] px-4 py-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="font-heading text-[26px] leading-none font-bold">{value}</span>
      {hint ? <span className="text-sm text-muted">{hint}</span> : null}
    </div>
  );
  const th = "py-1.5 pr-3 text-left text-sm font-semibold text-muted";
  const td = "py-1.5 pr-3 text-[15px] tabular-nums";

  return (
    <article
      className="mx-auto flex w-full max-w-[860px] flex-col gap-6 rounded-panel-lg bg-white p-6 text-night print:max-w-none print:rounded-none print:p-0"
      data-tv-case-study
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-bold">{t("title", { name: report.campaign.name })}</h1>
          <p className="text-sm text-muted">{t("sub")}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Link
            href="/admin/reklama/tv"
            className="inline-flex min-h-11 items-center px-2 text-[15px] underline"
          >
            {t("back")}
          </Link>
          <PrintButton label={t("print")} />
        </div>
      </header>

      <section aria-labelledby="cs-facts" className="flex flex-col gap-1">
        <h2 id="cs-facts" className="font-heading text-lg font-semibold">
          {t("facts")}
        </h2>
        {row(t("firstDay"), first ? fmtDay(first) : "—")}
        {row(t("lastDay"), last ? fmtDay(last) : "—")}
        {row(t("daysWithTv"), formatInt(days.length))}
        {row(t("impressions"), formatInt(stats?.impressions ?? s.impressions))}
        {row(t("reach"), formatInt(stats?.reach ?? 0))}
        <p className="pt-2 text-sm text-muted">
          {hasBase
            ? t("baseline", { from: fmtDay(base.from), to: fmtDay(base.to), days: base.days })
            : t("baselineNone")}
        </p>
      </section>

      <section aria-labelledby="cs-summary" className="flex flex-col gap-3">
        <h2 id="cs-summary" className="font-heading text-lg font-semibold">
          {t("summary")}
        </h2>
        <div className="flex flex-wrap gap-3">
          {stat(tt("sessionsAfter"), formatInt(s.sessionsAfter), tt("sessionsAfterHint"))}
          {stat(
            tt("expected"),
            num(s.expectedAfter),
            hasBase ? tt("expectedHint", { days: base.days }) : undefined,
          )}
          {stat(tt("uplift"), num(s.uplift), s.upliftPct === null ? undefined : pct(s.upliftPct))}
          {stat(tt("correlation"), corr(s.correlation), tt("correlationHint"))}
          {stat(tt("resultsAfter"), formatInt(s.resultsAfter))}
          {stat(tt("clicksAfter"), formatInt(s.clicksAfter))}
          {stat(
            tt("phoneAfter"),
            s.sessionsAfter > 0 ? `${Math.round((100 * s.phoneAfter) / s.sessionsAfter)} %` : "—",
          )}
          {stat(t("sessionsBefore"), sessionsBefore === null ? "—" : formatNumber(sessionsBefore, 1))}
          {stat(t("sessionsDuring"), sessionsDuring === null ? "—" : formatNumber(sessionsDuring, 1))}
        </div>
      </section>

      {days.length ? (
        <section aria-labelledby="cs-profile" className="flex flex-col gap-2">
          <h2 id="cs-profile" className="font-heading text-lg font-semibold">
            {t("profile")}
          </h2>
          <Profile
            title={tt("profile")}
            tone="light"
            impressions={s.profile.impressions}
            sessions={s.profile.sessions}
            baseline={hasBase ? s.profile.baseline : null}
            labels={{
              impressions: tt("impressions"),
              sessions: tt("sessionsUnit"),
              baseline: tt("baselineUnit"),
            }}
          />
        </section>
      ) : null}

      <section aria-labelledby="cs-days" className="flex flex-col gap-2">
        <h2 id="cs-days" className="font-heading text-lg font-semibold">
          {t("perDay")}
        </h2>
        {days.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[#DCE4E1]">
                  <th className={th}>{tt("day")}</th>
                  <th className={th}>{tt("impressions")}</th>
                  <th className={th}>{tt("sessionsAfterShort")}</th>
                  <th className={th}>{tt("expectedShort")}</th>
                  <th className={th}>{tt("upliftShort")}</th>
                  <th className={th}>{tt("resultsShort")}</th>
                  <th className={th}>{tt("clicksShort")}</th>
                  <th className={th}>{tt("correlation")}</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day} className="border-b border-[#EEF2F0]">
                    <td className={td}>{d.day}</td>
                    <td className={td}>{formatInt(d.impressions)}</td>
                    <td className={td}>{formatInt(d.sessionsAfter)}</td>
                    <td className={td}>{num(d.expectedAfter)}</td>
                    <td className={td}>{num(d.uplift)}</td>
                    <td className={td}>{formatInt(d.resultsAfter)}</td>
                    <td className={td}>{formatInt(d.clicksAfter)}</td>
                    <td className={td}>{corr(d.correlation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[15px] text-muted">{tt("noUplift")}</p>
        )}
      </section>

      <section aria-labelledby="cs-brand" className="flex flex-col gap-2">
        <h2 id="cs-brand" className="font-heading text-lg font-semibold">
          {t("brand")}
        </h2>
        <p className="text-sm text-muted">{t("brandSub")}</p>
        {report.brand.length ? (
          <table className="w-full max-w-[480px] border-collapse">
            <thead>
              <tr className="border-b border-[#DCE4E1]">
                <th className={th}>{t("brandDay")}</th>
                <th className={th}>{t("brandClicks")}</th>
                <th className={th}>{t("brandImpressions")}</th>
              </tr>
            </thead>
            <tbody>
              {report.brand.map((b) => (
                <tr key={b.day} className="border-b border-[#EEF2F0]">
                  <td className={td}>{b.day}</td>
                  <td className={td}>{formatInt(b.clicks)}</td>
                  <td className={td}>{formatInt(b.impressions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[15px] text-muted">{t("brandNone")}</p>
        )}
      </section>

      <section aria-labelledby="cs-method" className="flex flex-col gap-2">
        <h2 id="cs-method" className="font-heading text-lg font-semibold">
          {t("method")}
        </h2>
        <p className="text-[15px] leading-snug">{t("methodText")}</p>
        <p className="text-[15px] leading-snug text-muted">{t("honesty")}</p>
        <p className="text-sm text-muted">{t("generated", { date: formatDateShort(new Date()) })}</p>
      </section>
    </article>
  );
}
