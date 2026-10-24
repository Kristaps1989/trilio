import type { Metadata } from "next";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { adCampaigns, adDailyStats, adGroups, adKeywords, adSearchTerms, db } from "@/db";
import { formatInt } from "@/i18n/format";
import { dayOffset } from "@/services/ads/account";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, inputClass, labelClass, Section, Table } from "../../ui";
import { addNegativeAction } from "../actions";
import { AdsNav, eurFromMicros, Outcome } from "../shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Atslēgvārdi · Reklāma" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function AdsKeywords({ searchParams }: Props) {
  await requireAdmin("/admin/reklama/atslegvardi");
  const t = await getTranslations("admin.ads");
  const sp = await searchParams;
  const since = dayOffset(new Date(), 28);
  const campaigns = await db.select().from(adCampaigns).orderBy(adCampaigns.name);
  const name = new Map(campaigns.map((c) => [c.id, c.name]));
  const keywords = await db
    .select({ k: adKeywords, group: adGroups.name })
    .from(adKeywords)
    .leftJoin(adGroups, eq(adGroups.id, adKeywords.adGroupId))
    .orderBy(adGroups.name, adKeywords.text);
  const stats = await db
    .select({
      id: adDailyStats.entityId,
      clicks: sql<number>`sum(${adDailyStats.clicks})::int`,
      micros: sql<number>`sum(${adDailyStats.costMicros})::bigint`,
    })
    .from(adDailyStats)
    .where(and(eq(adDailyStats.level, "keyword"), gte(adDailyStats.day, since)))
    .groupBy(adDailyStats.entityId);
  const st = new Map(stats.map((s) => [s.id, s]));
  const terms = await db
    .select({
      term: adSearchTerms.term,
      group: adGroups.name,
      label: sql<string | null>`max(${adSearchTerms.label})`,
      clicks: sql<number>`sum(${adSearchTerms.clicks})::int`,
      micros: sql<number>`sum(${adSearchTerms.costMicros})::bigint`,
      conversions: sql<number>`sum(${adSearchTerms.conversions})::float`,
    })
    .from(adSearchTerms)
    .innerJoin(adGroups, eq(adGroups.id, adSearchTerms.adGroupId))
    .where(gte(adSearchTerms.day, since))
    .groupBy(adSearchTerms.term, adGroups.name)
    .orderBy(desc(sql`sum(${adSearchTerms.costMicros})`))
    .limit(100);
  const positive = keywords.filter((r) => !r.k.negative);
  const negatives = keywords.filter((r) => r.k.negative);
  const negativeTexts = [...new Set(negatives.map((r) => r.k.text))];

  return (
    <>
      <AdminTitle title={t("keywordsTitle")} />
      <AdsNav active="keywords" />
      <Outcome ok={sp.ok ? t("negativeAdded") : null} err={sp.err ?? null} />
      <Section title={t("negativesTitle")} id="negatives">
        <form action={addNegativeAction} className="flex flex-wrap items-end gap-3" data-add-negative>
          <label className={labelClass}>
            {t("negativeText")}
            <input name="text" required minLength={2} maxLength={80} className={inputClass} />
          </label>
          <label className={labelClass}>
            {t("negativeCampaign")}
            <select name="campaignId" className={inputClass}>
              <option value="all">{t("allCampaigns")}</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="outline" size="sm">
            {t("addNegative")}
          </Button>
        </form>
        <p className="text-[15px] text-stone" data-negatives>
          {negativeTexts.join(" · ")}
        </p>
      </Section>
      <Section title={t("termsTitle")} id="terms">
        <Table
          caption={t("termsTitle")}
          head={[
            t("colTerm"),
            t("colGroup"),
            t("colLabel"),
            t("colClicks28"),
            t("colCost28"),
            t("colConversions"),
          ]}
          empty={t("noRun")}
          rows={terms.map((r) => [
            r.term,
            r.group,
            r.label ? (
              <Chip tone={r.label === "relevant" ? "lime" : r.label === "irrelevant" ? "warning" : "neutral"}>
                {t(`label_${r.label}` as "label_relevant")}
              </Chip>
            ) : (
              "—"
            ),
            formatInt(Number(r.clicks)),
            eurFromMicros(Number(r.micros)),
            String(Math.round(Number(r.conversions) * 10) / 10),
          ])}
        />
      </Section>
      <Section title={t("keywordsTitle")} id="keywords">
        <Table
          caption={t("keywordsTitle")}
          head={[
            t("colKeyword"),
            t("colMatch"),
            t("colGroup"),
            t("colStatus"),
            t("colSource"),
            t("colClicks28"),
            t("colCost28"),
          ]}
          rows={positive.map(({ k, group }) => [
            <span key="k" data-keyword={k.text}>
              {k.text}
            </span>,
            k.match,
            group ?? name.get(k.campaignId) ?? "—",
            t(`status_${k.status}` as "status_draft"),
            k.source,
            formatInt(Number(st.get(k.id)?.clicks ?? 0)),
            eurFromMicros(Number(st.get(k.id)?.micros ?? 0)),
          ])}
        />
      </Section>
    </>
  );
}
