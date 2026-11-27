import type { Metadata } from "next";
import { and, gte, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { db, metaAdDaily, metaAdEntities } from "@/db";
import { googleShareCents } from "@/domain/ads/budget";
import { formatInt } from "@/i18n/format";
import { dayOffset, getSettings } from "@/services/ads/account";
import { channelPerformance, recentMarketingActions } from "@/services/marketing/manager";
import { metaAdsFromEnv } from "@/services/marketing/meta-ads";
import { agentAds, creatorConfigFromEnv } from "@/services/marketing/meta-creator";
import { formatDateShort } from "@/i18n/format";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, Section, Table } from "../../ui";
import { runMarketingAction } from "../actions";
import { AdsNav, eurFromCents, Outcome } from "../shared";

// Reklāma → Kanāli: one daily budget for Google and Meta (docs/GROWTH_PLAN.md, "One agent
// for every channel"). Where today's budget goes, what each channel's e-mail costs, Meta's
// campaigns and ads as last read, and every step the manager took or suggests.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kanāli · Reklāma" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

/** The tags a Meta ad's link needs so Trilio can tell which ad brought an e-mail. */
const META_URL_TAGS =
  "utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}";

export default async function AdsChannels({ searchParams }: Props) {
  await requireAdmin("/admin/reklama/kanali");
  const t = await getTranslations("admin.ads");
  const sp = await searchParams;
  const settings = await getSettings(db);
  const connected = metaAdsFromEnv() !== null;
  const perf = await channelPerformance(db);
  const from = dayOffset(new Date(), 28);
  const spend = new Map(
    (
      await db
        .select({
          id: metaAdDaily.adId,
          campaign: metaAdDaily.campaignId,
          cents: sql<number>`sum(${metaAdDaily.spendCents})::int`,
          clicks: sql<number>`sum(${metaAdDaily.linkClicks})::int`,
        })
        .from(metaAdDaily)
        .where(and(gte(metaAdDaily.day, from)))
        .groupBy(metaAdDaily.adId, metaAdDaily.campaignId)
    ).map((r) => [r.id, r]),
  );
  const entities = await db.select().from(metaAdEntities);
  const order = { campaign: 0, adset: 1, ad: 2 } as Record<string, number>;
  const listed = [...entities].sort(
    (a, b) =>
      (a.campaignId ?? a.id).localeCompare(b.campaignId ?? b.id) ||
      (order[a.level] ?? 9) - (order[b.level] ?? 9) ||
      a.name.localeCompare(b.name),
  );
  const totals = (e: (typeof entities)[number]) => {
    const rows = [...spend.values()].filter((r) =>
      e.level === "ad" ? r.id === e.id : e.level === "campaign" ? r.campaign === e.id : false,
    );
    return e.level === "adset"
      ? null
      : {
          cents: rows.reduce((a, r) => a + Number(r.cents), 0),
          clicks: rows.reduce((a, r) => a + Number(r.clicks), 0),
        };
  };
  const steps = await recentMarketingActions(db);
  const own = await agentAds(db);
  const canCreate = creatorConfigFromEnv() !== null;
  const today = {
    google: googleShareCents(settings),
    meta: settings.metaManaged ? settings.metaDailyCents : 0,
  };
  const ok =
    sp.ok === "applied" ? t("marketingApplied") : sp.ok === "suggested" ? t("marketingSuggested") : null;
  const err = sp.err ? (sp.err === "off" ? t("marketingOff") : sp.err) : null;

  return (
    <>
      <AdminTitle title={t("channelsTitle")} sub={t("channelsIntro")} />
      <AdsNav active="channels" />
      <Outcome ok={ok} err={err} />
      {!settings.metaManaged ? <p className="text-[15px] text-stone">{t("channelsOff")}</p> : null}
      {!connected ? <p className="text-[15px] text-stone">{t("channelsNoMeta")}</p> : null}
      {settings.metaManaged && settings.mode !== "manage" ? (
        <p className="text-[15px] text-stone">{t("channelsSuggest")}</p>
      ) : null}

      <Table
        caption={t("channelsTitle")}
        head={[
          t("colChannel"),
          t("colToday"),
          t("colSpend28"),
          t("colLeads28"),
          t("colCostPerLead"),
          t("colState"),
        ]}
        empty=""
        rows={(["google", "meta"] as const).map((id) => [
          <span key="c" data-channel={id}>
            {t(id === "google" ? "channelGoogle" : "channelMeta")}
          </span>,
          eurFromCents(today[id]),
          eurFromCents(perf[id].spendCents),
          formatInt(perf[id].leads),
          perf[id].costPerLeadCents === null ? "—" : eurFromCents(perf[id].costPerLeadCents!),
          <Chip key="s" tone={perf[id].active ? "lime" : "neutral"}>
            {t(perf[id].active ? "channelRunning" : "channelStopped")}
          </Chip>,
        ])}
      />
      <form action={runMarketingAction}>
        <Button type="submit" variant="outline" size="sm">
          {t("runMarketing")}
        </Button>
      </form>

      <Section title={t("metaAdsTitle")} id="meta-ads">
        <Table
          caption={t("metaAdsTitle")}
          head={[
            t("colMetaName"),
            t("colMetaLevel"),
            t("colState"),
            t("colMetaBudget"),
            t("colMetaSpend"),
            t("colMetaClicks"),
          ]}
          empty={t("metaAdsEmpty")}
          rows={listed.map((e) => {
            const sum = totals(e);
            return [
              <span key="n" data-meta-entity={e.level} className="break-words">
                {e.name}
              </span>,
              t(`metaLevel_${e.level}` as "metaLevel_campaign"),
              <Chip key="s" tone={e.effectiveStatus === "ACTIVE" ? "lime" : "neutral"}>
                {e.effectiveStatus}
              </Chip>,
              e.dailyBudgetCents === null ? "—" : eurFromCents(e.dailyBudgetCents),
              sum ? eurFromCents(sum.cents) : "—",
              sum ? formatInt(sum.clicks) : "—",
            ];
          })}
        />
        <div className="flex max-w-2xl flex-col gap-1 text-[15px] text-stone">
          <h3 className="font-semibold text-mist">{t("metaTagsTitle")}</h3>
          <p>{t("metaTagsBody")}</p>
          <code className="rounded-[10px] border-[1.5px] border-line-25 px-3 py-2 text-sm break-all text-mist">
            {META_URL_TAGS}
          </code>
        </div>
      </Section>

      <Section title={t("agentAdsTitle")} id="agent-ads">
        <p className="max-w-2xl text-[15px] text-stone">{t("agentAdsIntro")}</p>
        {!canCreate ? <p className="text-[15px] text-stone">{t("agentAdsNoConfig")}</p> : null}
        <Table
          caption={t("agentAdsTitle")}
          head={[t("colAd"), t("colAdText"), t("colAdSince"), t("colState")]}
          empty={t("agentAdsEmpty")}
          rows={own.map((a) => [
            <span key="n" data-agent-ad={a.status} data-format={a.format} className="break-words">
              {a.headline}
              <span className="block text-sm text-stone">
                {t.has(`agentAdFormat_${a.format}`)
                  ? t(`agentAdFormat_${a.format}` as "agentAdFormat_collage")
                  : a.format}
                {" · "}
                {a.name}
              </span>
              <a href={a.link} target="_blank" rel="noopener noreferrer" className="block text-sm underline">
                {t("agentAdOpen")}
              </a>
            </span>,
            <span key="m" className="text-sm break-words whitespace-pre-line">
              {a.message}
            </span>,
            formatDateShort(a.createdAt),
            <span key="s">
              <Chip tone={a.status === "active" ? "lime" : "neutral"}>
                {t(a.status === "active" ? "agentAdActive" : "agentAdPaused")}
              </Chip>
              {a.retiredWhy && t.has(`agentAdWhy_${a.retiredWhy}`) ? (
                <span className="block text-sm text-stone">
                  {t(`agentAdWhy_${a.retiredWhy}` as "agentAdWhy_facts")}
                </span>
              ) : null}
            </span>,
          ])}
        />
      </Section>

      <Section title={t("stepsTitle")} id="steps">
        <Table
          caption={t("stepsTitle")}
          head={[t("colWhen"), t("colStep"), t("colWhy"), t("colOutcome")]}
          empty={t("stepsEmpty")}
          rows={steps.map((s) => [
            s.day,
            <span key="k" data-step={s.kind}>
              {t(`step_${s.kind}` as "step_split")}
            </span>,
            <span key="r" className="text-sm break-words">
              {s.reason}
              {s.error ? <span className="block text-warning">{s.error}</span> : null}
            </span>,
            <Chip key="o" tone={s.error ? "warning" : s.applied ? "lime" : "neutral"}>
              {t(s.error ? "stepFailed" : s.applied ? "stepApplied" : "stepSuggested")}
            </Chip>,
          ])}
        />
      </Section>
    </>
  );
}
