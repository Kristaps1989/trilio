import { getTranslations } from "next-intl/server";
import { formatInt } from "@/i18n/format";
import { householdSummary, type TvPixelReport, type TvReport } from "@/services/growth/tv";
import { Stat, Stats, Table } from "../../ui";
import { num } from "./Effect";

// What the pixel carries and what it can prove (docs/TV_PIXEL_BEST_PRACTICE.md):
// the households that came after the spot (and the holdout, when Go3 keeps
// one), the flight's own days without TV, the frequency, the creatives and
// channels, and the diagnostic of the request itself.

const rate = (n: number, of: number) => (of > 0 ? `${((100 * n) / of).toFixed(1).replace(".", ",")} %` : "—");
const liftText = (l: { lift: number; low: number; high: number } | null) =>
  l
    ? `${l.lift >= 0 ? "+" : "−"}${Math.abs(Math.round(l.lift * 100))} % (${Math.round(l.low * 100)}…${Math.round(l.high * 100)} %)`
    : "—";

export async function Households({ report, pixel }: { report: TvReport; pixel: TvPixelReport }) {
  const t = await getTranslations("admin.ads.tv");
  const latest = pixel.days[0]?.household ?? null;
  if (report.households.length === 0)
    return (
      <p className="max-w-3xl text-sm text-stone" data-tv-households="none">
        {t(`household.reason.${latest?.reason ?? "none"}` as "household.reason.none")}
      </p>
    );
  const s = householdSummary(report.households);
  return (
    <div className="flex flex-col gap-3" data-tv-households={s.exposed}>
      <Stats>
        <Stat label={t("household.exposed")} value={formatInt(s.exposed)} hint={s.sources.join(", ")} />
        <Stat label={t("household.direct")} value={formatInt(s.direct)} hint={rate(s.direct, s.exposed)} />
        <Stat label={t("household.week")} value={formatInt(s.week)} hint={rate(s.week, s.exposed)} />
        {s.control > 0 ? (
          <>
            <Stat
              label={t("household.control")}
              value={formatInt(s.control)}
              hint={`${rate(s.controlDirect, s.control)} · ${rate(s.controlWeek, s.control)}`}
            />
            <Stat label={t("household.liftDirect")} value={liftText(s.liftDirect)} />
            <Stat label={t("household.liftWeek")} value={liftText(s.liftWeek)} />
          </>
        ) : null}
      </Stats>
      <Table
        caption={t("household.perDay")}
        head={[
          t("day"),
          t("household.exposed"),
          t("household.direct"),
          t("household.week"),
          t("household.control"),
          t("household.controlRates"),
        ]}
        rows={report.households.map((d) => [
          d.day,
          formatInt(d.exposed),
          `${formatInt(d.direct)} · ${rate(d.direct, d.exposed)}`,
          `${formatInt(d.week)} · ${rate(d.week, d.exposed)}`,
          formatInt(d.control),
          d.control ? `${rate(d.controlDirect, d.control)} · ${rate(d.controlWeek, d.control)}` : "—",
        ])}
      />
      <p className="max-w-3xl text-sm text-stone">{t("household.method")}</p>
    </div>
  );
}

export async function OffDays({ report }: { report: TvReport }) {
  const t = await getTranslations("admin.ads.tv");
  const o = report.offDays;
  if (!o) return <p className="max-w-3xl text-sm text-stone">{t("offDays.none")}</p>;
  return (
    <div className="flex flex-col gap-2" data-tv-off-days={o.days.length}>
      <Stats>
        <Stat label={t("sessionsAfter")} value={formatInt(o.sessionsAfter)} />
        <Stat
          label={t("offDays.expected")}
          value={num(o.expectedAfter)}
          hint={t("offDays.days", { n: o.days.length })}
        />
        <Stat label={t("offDays.uplift")} value={num(o.uplift)} />
      </Stats>
      <p className="max-w-3xl text-sm text-stone">{t("offDays.method", { days: o.days.join(", ") })}</p>
    </div>
  );
}

export async function PixelDetail({ pixel }: { pixel: TvPixelReport }) {
  const t = await getTranslations("admin.ads.tv");
  const dim = (key: keyof TvPixelReport["dims"]) =>
    pixel.dims[key].length ? (
      <Table
        key={key}
        caption={t(`px.dim.${key}` as "px.dim.cr")}
        head={[t(`px.dim.${key}` as "px.dim.cr"), t("impressions")]}
        rows={pixel.dims[key].map((d) => [d.value, formatInt(d.hits)])}
      />
    ) : null;
  const yes = (n: number | undefined, of: number) => (n ? rate(n, of) : "—");
  return (
    <div className="flex flex-col gap-3" data-tv-pixel-days={pixel.days.length}>
      <Table
        caption={t("px.caption")}
        head={[
          t("day"),
          t("px.requests"),
          t("px.hops"),
          "X-Device-IP",
          "X-Device-User-Agent",
          t("px.macros"),
          t("px.distinct"),
          t("reachDay"),
          t("px.verdict"),
        ]}
        empty={t("px.empty")}
        rows={pixel.days.map((d) => [
          d.day,
          d.control
            ? `${formatInt(d.total)} (${t("px.controlShort")} ${formatInt(d.control)})`
            : formatInt(d.total),
          d.hops.map((n) => formatInt(n)).join(" / "),
          yes(d.headers["x-device-ip"], d.total),
          yes(d.headers["x-device-user-agent"], d.total),
          ["ip", "ts", "cr", "ch", "pos"].filter((k) => d.params[k]).join(", ") || "—",
          `${formatInt(d.distinct.xff0 ?? 0)} / ${formatInt(d.distinct.device ?? 0)} / ${formatInt(d.distinct.macro ?? 0)}`,
          formatInt(d.reach),
          t(`household.verdict.${d.household.reason}` as "household.verdict.none"),
        ])}
      />
      <p className="max-w-3xl text-sm text-stone">{t("px.method")}</p>
      <Table
        caption={t("px.frequency")}
        head={[t("px.band"), t("px.devices")]}
        rows={pixel.frequency.map((f) => [t("px.bandLabel", { band: f.band }), formatInt(f.devices)])}
      />
      <p className="max-w-3xl text-sm text-stone">{t("px.frequencyMethod")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {dim("cr")}
        {dim("ch")}
        {dim("pos")}
        {dim("ua")}
        {dim("dua")}
      </div>
    </div>
  );
}
