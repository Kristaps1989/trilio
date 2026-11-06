import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatInt, formatNumber } from "@/i18n/format";
import type { TvReport } from "@/services/growth/tv";
import { Stat, Stats, Table } from "../../ui";
import { Profile } from "./Profile";

// A campaign's effect on the site's traffic (docs/TV_ANALYTICS_PLAN.md §3):
// the summary figures, the 24-hour profile and the per-day table, shared by
// the TV tab (dark) and the printable report (light).

export const pct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v)} %`);
export const num = (v: number | null, digits = 1) => (v === null ? "—" : formatNumber(v, digits));
export const corr = (v: number | null) => (v === null ? "—" : formatNumber(v, 2));

export async function EffectSummary({ report, tone }: { report: TvReport; tone: "dark" | "light" }) {
  const t = await getTranslations("admin.ads.tv");
  const s = report.summary;
  const base = report.baseline;
  return (
    <div className="flex flex-col gap-3" data-tv-effect data-tv-sessions-after={s.sessionsAfter}>
      <Stats>
        <Stat label={t("sessionsAfter")} value={formatInt(s.sessionsAfter)} hint={t("sessionsAfterHint")} />
        <Stat
          label={t("expected")}
          value={num(s.expectedAfter)}
          hint={base && base.days > 0 ? t("expectedHint", { days: base.days }) : t("noBaselineShort")}
        />
        <Stat
          label={t("uplift")}
          value={num(s.uplift)}
          hint={s.upliftPct === null ? undefined : pct(s.upliftPct)}
        />
        <Stat label={t("correlation")} value={corr(s.correlation)} hint={t("correlationHint")} />
        <Stat label={t("resultsAfter")} value={formatInt(s.resultsAfter)} />
        <Stat label={t("clicksAfter")} value={formatInt(s.clicksAfter)} />
        <Stat
          label={t("phoneAfter")}
          value={s.sessionsAfter > 0 ? `${Math.round((100 * s.phoneAfter) / s.sessionsAfter)} %` : "—"}
        />
      </Stats>
      {s.days > 0 ? (
        <Profile
          title={t("profile")}
          tone={tone}
          impressions={s.profile.impressions}
          sessions={s.profile.sessions}
          baseline={base && base.days > 0 ? s.profile.baseline : null}
          labels={{ impressions: t("impressions"), sessions: t("sessionsUnit"), baseline: t("baselineUnit") }}
        />
      ) : null}
    </div>
  );
}

export async function EffectDays({ report }: { report: TvReport }) {
  const t = await getTranslations("admin.ads.tv");
  return (
    <Table
      caption={t("perDayEffect")}
      head={[
        t("day"),
        t("impressions"),
        t("sessionsAfterShort"),
        t("expectedShort"),
        t("upliftShort"),
        t("resultsShort"),
        t("clicksShort"),
      ]}
      empty={t("noUplift")}
      rows={report.days
        .slice(0, 60)
        .map((d) => [
          d.live ? `${d.day} · ${t("live")}` : d.day,
          formatInt(d.impressions),
          formatInt(d.sessionsAfter),
          num(d.expectedAfter),
          num(d.uplift),
          formatInt(d.resultsAfter),
          formatInt(d.clicksAfter),
        ])}
    />
  );
}

export async function ReportLink({ slug }: { slug: string }) {
  const t = await getTranslations("admin.ads.tv");
  return (
    <Link
      href={`/admin/reklama/tv/${slug}/parskats`}
      className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-line-25 px-4 text-[15px] font-semibold text-mist"
      data-tv-report-link
    >
      {t("report")}
    </Link>
  );
}
