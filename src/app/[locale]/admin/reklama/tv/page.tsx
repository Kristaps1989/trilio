import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { pixelUrl, shortLinkUrl } from "@/domain/growth/tv";
import { formatInt } from "@/i18n/format";
import { tvStats } from "@/services/growth/tv";
import { appBaseUrl } from "@/services/payments";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../../guard";
import { AdminTitle, inputClass, labelClass, Section, Stat, Stats, Table } from "../../ui";
import { createTvCampaignAction, deleteTvCampaignAction } from "../actions";
import { AdsNav, Outcome } from "../shared";

// Reklāma → TV (docs/GROWTH_PLAN.md, TV): addressable TV campaigns (Go3) with
// Trilio's own impression tracker and short link.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "TV · Reklāma" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AdsTv({ searchParams }: Props) {
  await requireAdmin("/admin/reklama/tv");
  const t = await getTranslations("admin.ads.tv");
  const sp = await searchParams;
  const base = appBaseUrl();
  const campaigns = await tvStats(db);
  const err = sp.err ? (t.has(`err.${sp.err}`) ? t(`err.${sp.err}`) : sp.err) : null;
  return (
    <>
      <AdminTitle title={t("title")} sub={t("sub")} />
      <AdsNav active="tv" />
      <Outcome ok={sp.ok ? t(sp.ok === "deleted" ? "deleted" : "created") : null} err={err} />

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
      </Section>

      {campaigns.length === 0 ? <p className="text-[15px] text-stone">{t("none")}</p> : null}
      {campaigns.map((c) => (
        <Section key={c.campaign.slug} title={c.campaign.name} id={`tv-${c.campaign.slug}`}>
          <div
            className="flex flex-col gap-3"
            data-tv-campaign={c.campaign.slug}
            data-tv-impressions={c.impressions}
            data-tv-reach={c.reach}
            data-tv-links={c.linkOpens}
            data-tv-visits={c.visits}
          >
            <Stats>
              <Stat label={t("impressions")} value={formatInt(c.impressions)} />
              <Stat label={t("reach")} value={formatInt(c.reach)} hint={t("reachHint")} />
              <Stat label={t("linkOpens")} value={formatInt(c.linkOpens)} />
              <Stat label={t("visits")} value={formatInt(c.visits)} />
              <Stat label={t("shopClicks")} value={formatInt(c.shopClicks)} />
            </Stats>
            <label className={labelClass}>
              {t("pixel")}
              <input
                readOnly
                value={pixelUrl(base, c.campaign.slug)}
                className={`${inputClass} font-mono text-sm`}
                data-tv-pixel
              />
            </label>
            <label className={labelClass}>
              {t("short")}
              <input
                readOnly
                value={shortLinkUrl(base, c.campaign.slug)}
                className={`${inputClass} font-mono text-sm`}
                data-tv-short
              />
            </label>
            <p className="text-sm text-stone">{t("leadsTo", { path: c.campaign.landingPath })}</p>
            <Table
              caption={t("perDay")}
              head={[t("day"), t("impressions"), t("reachDay"), t("linkOpens")]}
              empty={t("noData")}
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
      ))}
    </>
  );
}
