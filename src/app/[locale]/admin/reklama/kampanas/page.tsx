import type { Metadata } from "next";
import { and, eq, gte, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { adCampaigns, adDailyStats, adGroups, db } from "@/db";
import { formatInt } from "@/i18n/format";
import { catalog } from "@/domain/questions/catalog";
import { dayOffset } from "@/services/ads/account";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, inputClass, labelClass, Section, Table } from "../../ui";
import { createPmaxAction, refreshAdsAction, setCampaignStatusAction } from "../actions";
import { AdsNav, eurFromCents, eurFromMicros, Outcome } from "../shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kampaņas · Reklāma" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AdsCampaigns({ searchParams }: Props) {
  await requireAdmin("/admin/reklama/kampanas");
  const t = await getTranslations("admin.ads");
  const sp = await searchParams;
  const campaigns = await db.select().from(adCampaigns).orderBy(adCampaigns.name);
  const groups = await db
    .select({ campaignId: adGroups.campaignId, n: sql<number>`count(*)::int` })
    .from(adGroups)
    .groupBy(adGroups.campaignId);
  const stats = await db
    .select({
      id: adDailyStats.entityId,
      clicks: sql<number>`sum(${adDailyStats.clicks})::int`,
      micros: sql<number>`sum(${adDailyStats.costMicros})::bigint`,
    })
    .from(adDailyStats)
    .where(and(eq(adDailyStats.level, "campaign"), gte(adDailyStats.day, dayOffset(new Date(), 7))))
    .groupBy(adDailyStats.entityId);
  const st = new Map(stats.map((s) => [s.id, s]));
  const tone = (s: string) => (s === "enabled" ? "lime" : s === "paused" ? "warning" : "neutral");
  const refreshed = sp.refreshed?.split("/").map(Number) ?? [];
  const ok =
    sp.ok === "pmax"
      ? t("pmaxDone")
      : sp.enabled
        ? t("enabled", { count: sp.enabled })
        : refreshed.length === 3
          ? t("adsRefreshed", { created: refreshed[0]!, paused: refreshed[1]!, failed: refreshed[2]! })
          : null;

  return (
    <>
      <AdminTitle title={t("campaignsTitle")} />
      <AdsNav active="campaigns" />
      <Outcome ok={ok} err={sp.err ? t("pmaxFailed", { reason: sp.err }) : null} />
      <Table
        caption={t("campaignsTitle")}
        head={[
          t("colCampaign"),
          t("colStatus"),
          t("colBudget"),
          t("colClicks7"),
          t("colCost7"),
          t("colGroups"),
          t("colActions"),
        ]}
        empty={t("noRun")}
        rows={campaigns.map((c) => [
          <span key="n" data-campaign={c.name}>
            {c.name}
          </span>,
          <Chip key="s" tone={tone(c.status)}>
            {t(`status_${c.status}` as "status_draft")}
          </Chip>,
          eurFromCents(c.budgetCents),
          formatInt(Number(st.get(c.id)?.clicks ?? 0)),
          eurFromMicros(Number(st.get(c.id)?.micros ?? 0)),
          formatInt(Number(groups.find((g) => g.campaignId === c.id)?.n ?? 0)),
          c.googleId ? (
            <form key="a" action={setCampaignStatusAction}>
              <input type="hidden" name="campaignId" value={c.id} />
              <input type="hidden" name="status" value={c.status === "enabled" ? "paused" : "enabled"} />
              <Button type="submit" variant="outline" size="sm">
                {c.status === "enabled" ? t("pause") : t("enable")}
              </Button>
            </form>
          ) : (
            "—"
          ),
        ])}
      />
      <Section title={t("adsTitle")} id="ads">
        <p className="text-[15px] text-stone">{t("adsHint")}</p>
        <form action={refreshAdsAction}>
          <Button type="submit" variant="outline" size="sm">
            {t("refreshAds")}
          </Button>
        </form>
      </Section>

      <Section title={t("pmaxTitle")} id="pmax">
        <p className="text-[15px] text-stone">{t("pmaxHint")}</p>
        <form action={createPmaxAction} className="flex flex-wrap items-end gap-3">
          <label className={labelClass}>
            {t("pmaxGroup")}
            <select name="groupId" className={inputClass}>
              {catalog.groups
                .filter((g) => g.subcategories.length > 0)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("pmaxBudget")}
            <input name="budget" defaultValue="5" inputMode="decimal" className={inputClass} />
          </label>
          <Button type="submit" variant="outline" size="sm">
            {t("pmaxCreate")}
          </Button>
        </form>
      </Section>
    </>
  );
}
