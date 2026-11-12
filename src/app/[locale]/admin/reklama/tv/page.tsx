import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import {
  controlPixelUrl,
  displayPixelUrl,
  extendedPixelUrl,
  landingWithTags,
  pixelUrl,
  shortLinkUrl,
} from "@/domain/growth/tv";
import { parseTvRange, rangeDays, TV_RANGES } from "@/domain/admin/stats";
import { formatInt } from "@/i18n/format";
import { CHANNELS, TV_ELIGIBLE } from "@/domain/growth/channels";
import {
  flightOverlap,
  tvPixelReport,
  tvReport,
  tvStats,
  type FlightOverlap,
  type TvReport,
} from "@/services/growth/tv";
import { appBaseUrl } from "@/services/payments";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../../guard";
import { AdminTitle, FilterLinks, inputClass, labelClass, Section, Stat, Stats, Table } from "../../ui";
import {
  createTvCampaignAction,
  deleteTvCampaignAction,
  linkFlightAction,
  recomputeTvBaselineAction,
  unlinkFlightAction,
} from "../actions";
import { AdsNav, Outcome } from "../shared";
import { EffectDays, EffectSummary, ReportLink } from "./Effect";
import { Households, OffDays, PixelDetail } from "./Pixel";

// Reklāma → TV (docs/GROWTH_PLAN.md, TV): addressable TV campaigns (Go3) with
// Trilio's own impression tracker and short link, and each campaign's effect
// on the site's traffic (docs/TV_ANALYTICS_PLAN.md).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "TV · Reklāma" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AdsTv({ searchParams }: Props) {
  await requireAdmin("/admin/reklama/tv");
  const t = await getTranslations("admin.ads.tv");
  const sp = await searchParams;
  const base = appBaseUrl();
  const period = parseTvRange(sp.periods);
  const r = rangeDays(period, new Date());
  const range = { from: r.from, to: r.to };
  const campaigns = await tvStats(db, range);
  const reports = new Map(
    await Promise.all(
      campaigns.map(
        async (c) => [c.campaign.slug, await tvReport(db, c.campaign.slug, new Date(), range)] as const,
      ),
    ),
  );
  const pixels = new Map(
    await Promise.all(
      campaigns.map(async (c) => [c.campaign.slug, await tvPixelReport(db, c.campaign.slug, range)] as const),
    ),
  );
  const overlaps = new Map(
    await Promise.all(
      campaigns.map(async (c) => [c.campaign.slug, await flightOverlap(db, c.campaign.slug)] as const),
    ),
  );
  const err = sp.err ? (t.has(`err.${sp.err}`) ? t(`err.${sp.err}`) : sp.err) : null;
  return (
    <>
      <AdminTitle title={t("title")} sub={t("sub")} />
      <AdsNav active="tv" />
      <div className="flex flex-wrap items-center gap-3" data-tv-period={period}>
        <FilterLinks
          label={t("period")}
          items={TV_RANGES.map((k) => ({
            href: `/admin/reklama/tv?periods=${k}`,
            label: t(`range.${k}`),
            active: k === period,
          }))}
        />
        <span className="text-sm text-stone">{t("periodDays", { from: r.from, to: r.to })}</span>
      </div>
      <Outcome
        ok={
          sp.ok
            ? t(
                sp.ok === "deleted"
                  ? "deleted"
                  : sp.ok === "baseline"
                    ? "baselineDone"
                    : sp.ok === "flight"
                      ? "flight.linked"
                      : sp.ok === "unflight"
                        ? "flight.unlinked"
                        : "created",
              )
            : null
        }
        err={err}
      />

      <Section title={t("new")} id="tv-new">
        <form action={createTvCampaignAction} className="grid max-w-2xl gap-3 sm:grid-cols-2" data-tv-new>
          <label className={labelClass}>
            {t("name")}
            <input
              name="name"
              required
              maxLength={120}
              className={inputClass}
              placeholder="Go3 · Ledusskapji, novembris"
            />
          </label>
          <label className={labelClass}>
            {t("slug")}
            <input name="slug" maxLength={48} className={inputClass} placeholder="go3-ledusskapji" />
          </label>
          <label className={labelClass}>
            {t("kind")}
            <select name="kind" defaultValue="tv" className={inputClass}>
              <option value="tv">{t("kindTv")}</option>
              <option value="display">{t("kindDisplay")}</option>
            </select>
          </label>
          <label className={labelClass}>
            {t("source")}
            <input name="source" maxLength={40} className={inputClass} placeholder="tv3.lv" />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            {t("landing")}
            <input name="landingPath" defaultValue="/izvelies" className={inputClass} />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm">
              {t("create")}
            </Button>
          </div>
        </form>
        <p className="max-w-3xl text-sm text-stone">{t("how")}</p>
        <p className="max-w-3xl text-sm text-stone">{t("howDisplay")}</p>
      </Section>

      {campaigns.length === 0 ? <p className="text-[15px] text-stone">{t("none")}</p> : null}
      {campaigns.map((c) => {
        const display = c.campaign.kind === "display";
        const tags = landingWithTags(c.campaign.landingPath, c.campaign.slug, c.campaign);
        return (
          <Section
            key={c.campaign.slug}
            title={`${c.campaign.name} · ${t(display ? "kindDisplay" : "kindTv")}`}
            id={`tv-${c.campaign.slug}`}
          >
            <div
              className="flex flex-col gap-3"
              data-tv-campaign={c.campaign.slug}
              data-tv-kind={c.campaign.kind}
              data-tv-impressions={c.impressions}
              data-tv-reach={c.reach}
              data-tv-links={c.linkOpens}
              data-tv-visits={c.visits}
            >
              <Stats>
                <Stat label={t("impressions")} value={formatInt(c.impressions)} />
                <Stat label={t("reach")} value={formatInt(c.reach)} hint={t("reachHint")} />
                <Stat
                  label={t(display ? "clicks" : "linkOpens")}
                  value={formatInt(c.linkOpens)}
                  hint={
                    display && c.impressions
                      ? t("ctr", { pct: ((100 * c.linkOpens) / c.impressions).toFixed(2).replace(".", ",") })
                      : undefined
                  }
                />
                <Stat label={t(display ? "visitsDisplay" : "visits")} value={formatInt(c.visits)} />
                <Stat label={t("shopClicks")} value={formatInt(c.shopClicks)} />
              </Stats>
              <label className={labelClass}>
                {t(display ? "pixelDisplay" : "pixel")}
                <input
                  readOnly
                  value={(display ? displayPixelUrl : pixelUrl)(base, c.campaign.slug)}
                  className={`${inputClass} font-mono text-sm`}
                  data-tv-pixel
                />
              </label>
              <label className={labelClass}>
                {t(display ? "clickLink" : "short")}
                <input
                  readOnly
                  value={shortLinkUrl(base, c.campaign.slug)}
                  className={`${inputClass} font-mono text-sm`}
                  data-tv-short
                />
              </label>
              <p className="text-sm text-stone" data-tv-leads={tags}>
                {t("leadsToTags", { path: tags })}
              </p>
              {display ? <p className="max-w-3xl text-sm text-stone">{t("retarget")}</p> : null}
              <Flight
                slug={c.campaign.slug}
                overlap={overlaps.get(c.campaign.slug) ?? null}
                others={campaigns
                  .filter((o) => o.campaign.slug !== c.campaign.slug && !o.campaign.flightWith)
                  .map((o) => ({ slug: o.campaign.slug, name: o.campaign.name }))}
              />
              {display ? null : (
                <details className="max-w-3xl text-sm">
                  <summary className="cursor-pointer py-2 font-semibold">{t("pixelMore")}</summary>
                  <div className="flex flex-col gap-3 pt-2">
                    <p className="text-stone">{t("pixelMoreHow")}</p>
                    <label className={labelClass}>
                      {t("pixelExtended")}
                      <input
                        readOnly
                        value={extendedPixelUrl(base, c.campaign.slug)}
                        className={`${inputClass} font-mono text-sm`}
                        data-tv-pixel-extended
                      />
                    </label>
                    <label className={labelClass}>
                      {t("pixelControl")}
                      <input
                        readOnly
                        value={controlPixelUrl(base, c.campaign.slug)}
                        className={`${inputClass} font-mono text-sm`}
                        data-tv-pixel-control
                      />
                    </label>
                  </div>
                </details>
              )}
              {!display && reports.get(c.campaign.slug) ? (
                <Section
                  title={t("effect")}
                  id={`tv-effect-${c.campaign.slug}`}
                  action={<ReportLink slug={c.campaign.slug} />}
                >
                  <EffectSummary report={reports.get(c.campaign.slug)!} tone="dark" />
                  <EffectDays report={reports.get(c.campaign.slug)!} />
                  <ChannelMixLine report={reports.get(c.campaign.slug)!} />
                  <p className="max-w-3xl text-sm text-stone">{t("method")}</p>
                  <form action={recomputeTvBaselineAction} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="slug" value={c.campaign.slug} />
                    <Button type="submit" variant="outline" size="sm">
                      {t("baselineRecompute")}
                    </Button>
                    <span className="text-sm text-stone">{t("baselineRecomputeHint")}</span>
                  </form>
                </Section>
              ) : null}
              {reports.get(c.campaign.slug) ? (
                <>
                  {display ? null : (
                    <Section title={t("offDays.title")} id={`tv-off-${c.campaign.slug}`}>
                      <OffDays report={reports.get(c.campaign.slug)!} />
                    </Section>
                  )}
                  <Section title={t("household.title")} id={`tv-households-${c.campaign.slug}`}>
                    <Households report={reports.get(c.campaign.slug)!} pixel={pixels.get(c.campaign.slug)!} />
                  </Section>
                </>
              ) : null}
              <Section title={t("px.title")} id={`tv-pixel-${c.campaign.slug}`}>
                <PixelDetail pixel={pixels.get(c.campaign.slug)!} />
              </Section>
              <Table
                caption={t("perDay")}
                head={[t("day"), t("impressions"), t("reachDay"), t(display ? "clicks" : "linkOpens")]}
                empty={t("noDataPeriod")}
                rows={c.days
                  .slice(0, 30)
                  .map((d) => [d.day, formatInt(d.impressions), formatInt(d.reach), formatInt(d.linkOpens)])}
              />
              <form action={deleteTvCampaignAction}>
                <input type="hidden" name="slug" value={c.campaign.slug} />
                <Button type="submit" variant="outline" size="sm">
                  {t("delete")}
                </Button>
              </form>
            </div>
          </Section>
        );
      })}
    </>
  );
}

/** The campaign's flight: its partner and the households each reached, or the form to link one. */
async function Flight({
  slug,
  overlap,
  others,
}: {
  slug: string;
  overlap: FlightOverlap | null;
  others: { slug: string; name: string }[];
}) {
  const t = await getTranslations("admin.ads.tv.flight");
  if (!overlap)
    return others.length ? (
      <form
        action={linkFlightAction}
        className="flex max-w-3xl flex-wrap items-end gap-3"
        data-tv-flight-form
      >
        <input type="hidden" name="slug" value={slug} />
        <label className={labelClass}>
          {t("with")}
          <select name="partner" className={inputClass} required>
            {others.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline" size="sm">
          {t("link")}
        </Button>
        <span className="basis-full text-sm text-stone">{t("how")}</span>
      </form>
    ) : null;
  const g = overlap.groups;
  const total = g.own.households + g.partner.households + g.both.households;
  const row = (label: string, v: { households: number; came: number }) => [
    label,
    formatInt(v.households),
    total ? `${Math.round((100 * v.households) / total)} %` : "—",
    formatInt(v.came),
    v.households ? `${((100 * v.came) / v.households).toFixed(1).replace(".", ",")} %` : "—",
  ];
  return (
    <div
      className="flex flex-col gap-2"
      data-tv-flight={overlap.partner.slug}
      data-tv-flight-both={g.both.households}
    >
      <Table
        caption={t("title", { name: overlap.partner.name })}
        head={[t("group"), t("households"), t("share"), t("came"), t("rate")]}
        rows={[row(t("own"), g.own), row(t("partner"), g.partner), row(t("both"), g.both)]}
      />
      <p className="max-w-3xl text-sm text-stone">
        {t("method", { since: overlap.since.toISOString().slice(0, 10) })}
      </p>
      {overlap.devices ? (
        <Table
          caption={t("devicesTitle")}
          head={[t("deviceGroup"), t("households")]}
          rows={[
            [t("own"), formatInt(overlap.devices.own)],
            [t("partner"), formatInt(overlap.devices.partner)],
            [t("both"), formatInt(overlap.devices.both)],
          ]}
        />
      ) : null}
      <p className="max-w-3xl text-sm text-stone" data-tv-flight-devices={overlap.devices?.both ?? ""}>
        {t(overlap.devices ? "devicesMethod" : "devicesNone")}
      </p>
      <form action={unlinkFlightAction}>
        <input type="hidden" name="slug" value={slug} />
        <Button type="submit" variant="outline" size="sm">
          {t("unlink")}
        </Button>
      </form>
    </div>
  );
}

/** Visitors per channel next to the uplift (docs/TV_ANALYTICS_PLAN.md §8); ✓ marks what TV is measured on. */
async function ChannelMixLine({ report }: { report: TvReport }) {
  const t = await getTranslations("admin.ads.tv.channels");
  const mix = report.channels;
  const total = CHANNELS.reduce((n, c) => n + (mix[c] ?? 0), 0);
  return (
    <div className="flex max-w-3xl flex-col gap-1" data-tv-channels>
      <p className="text-[15px] font-semibold text-mist">{t("title")}</p>
      {total === 0 ? (
        <p className="text-sm text-stone">{t("none")}</p>
      ) : (
        <p className="text-[15px] text-mist">
          {CHANNELS.filter((c) => mix[c])
            .map(
              (c) =>
                `${TV_ELIGIBLE.has(c) ? "✓ " : ""}${t(c)} ${formatInt(mix[c]!)} (${Math.round((100 * mix[c]!) / total)} %)`,
            )
            .join(" · ")}
        </p>
      )}
      <p className="text-sm text-stone">{t("note")}</p>
    </div>
  );
}
