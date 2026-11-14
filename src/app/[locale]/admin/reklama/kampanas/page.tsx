import type { Metadata } from "next";
import { and, eq, gte, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { adCampaigns, adDailyStats, adGroups, db } from "@/db";
import { formatInt } from "@/i18n/format";
import { catalog } from "@/domain/questions/catalog";
import { campaignExtensions } from "@/domain/ads/plan";
import { dayOffset } from "@/services/ads/account";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, inputClass, labelClass, Section, Table } from "../../ui";
import { campaignPriorities } from "@/services/ads/priorities";
import { accountControl } from "@/services/ads/control";
import { fixable, type Issue } from "@/domain/ads/drift";
import type { Recommendation } from "@/domain/ads/priority";
import {
  applyRecommendationAction,
  checkAccountAction,
  createPmaxAction,
  pauseForeignAction,
  reconcileAccountAction,
  refreshAdsAction,
  setCampaignBudgetAction,
  setCampaignStatusAction,
  setDailyBudgetAction,
  tuneSearchAction,
} from "../actions";
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
  const tuned = sp.tuned?.split("/").map(Number) ?? [];
  const applied = sp.applied?.split("/").map(Number) ?? [];
  const priorities = await campaignPriorities(db);
  const untuned = campaigns.filter((c) => c.kind === "search" && c.googleId && !c.tunedAt).length;
  const why = (r: Recommendation) =>
    t(`priority.reason.${r.reason}` as "priority.reason.brand", {
      searches: r.facts.siteSearches,
      clicks: r.facts.adClicks,
      outcomes: r.facts.outcomes,
      have: priorities.conversions30d,
    });
  const ok =
    sp.ok === "pmax"
      ? t("pmaxDone")
      : sp.enabled
        ? t("enabled", { count: sp.enabled })
        : refreshed.length === 3
          ? t("adsRefreshed", { created: refreshed[0]!, paused: refreshed[1]!, failed: refreshed[2]! })
          : tuned.length === 2
            ? t("priority.tuned", { tuned: tuned[0]!, failed: tuned[1]! })
            : applied.length === 2
              ? t("priority.applied", { enabled: applied[0]!, skipped: applied[1]! })
              : sp.ok === "daily"
                ? t("priority.dailySaved")
                : sp.ok === "budget"
                  ? t("priority.budgetSaved")
                  : null;
  const reconciled = sp.reconciled?.split("/").map(Number) ?? [];
  const controlOk =
    reconciled.length === 3
      ? t("control.reconciled", { fixed: reconciled[0]!, failed: reconciled[1]!, left: reconciled[2]! })
      : sp.ok === "checked"
        ? t("control.checked")
        : sp.ok === "foreign"
          ? t("control.foreignPaused")
          : null;
  const berr =
    sp.berr === "control"
      ? t("control.failed")
      : sp.berr
        ? t(`priority.err.${sp.berr}` as "priority.err.daily")
        : null;
  const control = await accountControl(db);
  const when = (d: Date) =>
    new Intl.DateTimeFormat("lv-LV", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Riga",
    }).format(d);
  const bid = (b: string) => t(`control.bidding.${b}` as "control.bidding.other");
  const state = (x: string) => t(`control.state.${x}` as "control.state.paused");
  const issueText = (i: Issue): string => {
    switch (i.kind) {
      case "missing":
        return t("control.issue.missing");
      case "status":
        return t("control.issue.status", { google: state(i.google), trilio: state(i.trilio) });
      case "budget":
        return t("control.issue.budget", {
          google: eurFromCents(i.googleCents),
          trilio: eurFromCents(i.trilioCents),
        });
      case "shared_budget":
        return t("control.issue.shared_budget", { google: eurFromCents(i.googleCents) });
      case "bidding":
        return t("control.issue.bidding", {
          google: bid(i.google),
          trilio: bid(i.trilio),
          portfolio: i.portfolio ? "yes" : "no",
        });
      case "cpc_cap":
        return t("control.issue.cpc_cap", {
          google: i.googleCents === null ? t("control.issue.noCap") : eurFromCents(i.googleCents),
          trilio: eurFromCents(i.trilioCents),
        });
    }
  };
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const eurInput = (centsValue: number) => (centsValue / 100).toFixed(2).replace(".", ",");
  // A recommended campaign needs a click when it is off, or on with another budget than suggested.
  const todo = (r: Recommendation): "enable" | "budget" | null => {
    const c = byId.get(r.id);
    if (r.tier !== "now" || !c?.googleId) return null;
    if (c.status !== "enabled") return "enable";
    return r.budgetCents !== null && c.budgetCents !== r.budgetCents ? "budget" : null;
  };
  const nowCount = priorities.recommendations.filter((r) => todo(r) !== null).length;

  return (
    <>
      <AdminTitle title={t("campaignsTitle")} />
      <AdsNav active="campaigns" />
      <Outcome ok={controlOk ?? ok} err={berr ?? (sp.err ? t("pmaxFailed", { reason: sp.err }) : null)} />
      <Section title={t("control.title")} id="control">
        <p className="max-w-3xl text-[15px] text-stone">{t("control.intro")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <form action={checkAccountAction}>
            <Button type="submit" variant="outline" size="sm" data-control-check>
              {t("control.check")}
            </Button>
          </form>
          <span className="text-sm text-stone" data-control-checked={control ? "yes" : "no"}>
            {control ? t("control.checkedAt", { when: when(control.checkedAt) }) : t("control.never")}
          </span>
        </div>
        {control && control.drift.campaigns.length === 0 ? (
          <p className="text-[15px] text-mist" data-control-state="ok">
            {t("control.allGood", { count: control.drift.matching })}
          </p>
        ) : null}
        {control && control.drift.campaigns.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Chip tone="warning">
                <span data-control-state="differs">
                  {t("control.differ", { count: control.drift.campaigns.length })}
                </span>
              </Chip>
              <form action={reconcileAccountAction}>
                <Button type="submit" size="sm" data-control-fix-all>
                  {t("control.fixAll")}
                </Button>
              </form>
            </div>
            <Table
              caption={t("control.title")}
              head={[t("control.colCampaign"), t("control.colDiffers"), t("control.colAction")]}
              rows={control.drift.campaigns.map((c) => [
                <span key="n" data-control-campaign={c.name}>
                  {c.name}
                </span>,
                <ul key="i" className="grid gap-1">
                  {c.issues.map((i) => (
                    <li key={i.kind} data-control-issue={i.kind}>
                      {issueText(i)}
                    </li>
                  ))}
                </ul>,
                fixable(c.issues, c.kind) ? (
                  <form key="f" action={reconcileAccountAction}>
                    <input type="hidden" name="campaignId" value={c.id} />
                    <Button type="submit" variant="outline" size="sm" data-control-fix={c.name}>
                      {t("control.fix")}
                    </Button>
                  </form>
                ) : (
                  <span key="m" className="text-sm text-stone">
                    {t("control.manual")}
                  </span>
                ),
              ])}
            />
            <p className="max-w-3xl text-sm text-stone">{t("control.fixNote")}</p>
          </>
        ) : null}
        {control && control.drift.foreign.length > 0 ? (
          <>
            <h3 className="font-display text-lg text-mist">{t("control.foreignTitle")}</h3>
            <p className="max-w-3xl text-sm text-stone">{t("control.foreignNote")}</p>
            <Table
              caption={t("control.foreignTitle")}
              head={[
                t("control.colCampaign"),
                t("control.colState"),
                t("control.colBudget"),
                t("control.colBidding"),
                t("control.colAction"),
              ]}
              rows={control.drift.foreign.map((f) => [
                <span key="n" data-control-foreign={f.name}>
                  {f.name}
                </span>,
                <Chip key="s" tone={tone(f.status)}>
                  {state(f.status)}
                </Chip>,
                eurFromCents(f.budgetCents),
                bid(f.bidding),
                f.status === "enabled" ? (
                  <form key="p" action={pauseForeignAction}>
                    <input type="hidden" name="resource" value={f.resource} />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      aria-label={t("control.pauseOf", { name: f.name })}
                      data-control-pause={f.name}
                    >
                      {t("control.pause")}
                    </Button>
                  </form>
                ) : (
                  "—"
                ),
              ])}
            />
          </>
        ) : null}
      </Section>

      <Section title={t("priority.title")} id="priority">
        <p className="max-w-3xl text-[15px] text-stone">
          {t("priority.intro", { budget: eurFromCents(priorities.dailyBudgetCents) })}
        </p>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <form action={setDailyBudgetAction} className="flex flex-wrap items-end gap-3" data-daily-budget>
            <label className={labelClass}>
              {t("priority.daily")}
              <input
                key={priorities.dailyBudgetCents}
                name="daily"
                inputMode="decimal"
                defaultValue={eurInput(priorities.dailyBudgetCents)}
                className={`${inputClass} w-32`}
              />
            </label>
            <Button type="submit" variant="outline" size="sm">
              {t("priority.saveDaily")}
            </Button>
          </form>
          <form action={applyRecommendationAction}>
            <Button type="submit" size="sm" disabled={nowCount === 0}>
              {t("priority.applyAll", { count: nowCount })}
            </Button>
          </form>
        </div>
        <Table
          caption={t("priority.title")}
          head={[
            t("priority.rank"),
            t("colCampaign"),
            t("priority.advice"),
            t("priority.why"),
            t("priority.budget"),
            t("colStatus"),
          ]}
          empty={t("noRun")}
          rows={priorities.recommendations.map((r) => [
            r.rank ?? "—",
            <span key="n" data-priority={r.name} data-priority-tier={r.tier}>
              {r.name}
            </span>,
            todo(r) ? (
              <form key="t" action={applyRecommendationAction}>
                <input type="hidden" name="campaignId" value={r.id} />
                <Button type="submit" size="sm" data-apply={r.name}>
                  {t(todo(r) === "enable" ? "priority.tier.now" : "priority.applyBudget")}
                </Button>
              </form>
            ) : (
              <Chip key="t" tone={r.tier === "now" ? "lime" : r.tier === "next" ? "neutral" : "warning"}>
                {r.tier === "now" && r.facts.status === "enabled"
                  ? t("priority.running")
                  : r.tier === "now"
                    ? t("priority.sendFirst")
                    : t(`priority.tier.${r.tier}` as "priority.tier.now")}
              </Chip>
            ),
            why(r),
            r.budgetCents === null ? "—" : eurFromCents(r.budgetCents),
            <Chip key="s" tone={tone(r.facts.status)}>
              {t(`status_${r.facts.status}` as "status_draft")}
            </Chip>,
          ])}
        />
        <p className="max-w-3xl text-sm text-stone">{t("priority.method")}</p>
      </Section>

      <Section title={t("priority.practiceTitle")} id="practice">
        <ul className="max-w-3xl list-disc space-y-1 pl-5 text-[15px] text-stone">
          {(
            ["network", "geo", "languages", "match", "ads", "extensions", "negatives", "bidding"] as const
          ).map((k) => (
            <li key={k}>{t(`priority.practice.${k}`)}</li>
          ))}
        </ul>
        <Table
          caption={t("priority.linksTitle")}
          head={[t("colCampaign"), t("priority.links"), t("priority.linksStatus")]}
          empty={t("noRun")}
          rows={campaigns
            .filter((c) => c.kind === "search")
            .map((c) => [
              c.name,
              <span key="l" data-sitelinks={c.name}>
                {campaignExtensions(catalog.groups.find((g) => g.id === c.groupId))
                  .sitelinks.map((l) => l.text)
                  .join(" · ")}
              </span>,
              c.tunedAt
                ? t("priority.linksOn", { date: c.tunedAt.toISOString().slice(0, 10) })
                : c.googleId
                  ? t("priority.linksOff")
                  : t("priority.sendFirst"),
            ])}
        />
        <p className="max-w-3xl text-sm text-stone">{t("priority.linksNote")}</p>
        <form action={tuneSearchAction} className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" size="sm" disabled={untuned === 0}>
            {t("priority.tune")}
          </Button>
          <span className="text-sm text-stone" data-untuned={untuned}>
            {t("priority.tuneHint", { count: untuned })}
          </span>
        </form>
      </Section>

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
          <form
            key="b"
            action={setCampaignBudgetAction}
            className="flex items-center gap-2"
            data-budget={c.name}
          >
            <input type="hidden" name="campaignId" value={c.id} />
            <input
              // Remounted when the budget changes elsewhere (the recommendation, pacing), so the
              // field never keeps showing the old number.
              key={c.budgetCents}
              name="budget"
              inputMode="decimal"
              aria-label={t("priority.budgetOf", { name: c.name })}
              defaultValue={eurInput(c.budgetCents)}
              className={`${inputClass} w-24`}
            />
            <Button type="submit" variant="outline" size="sm">
              {t("priority.saveBudget")}
            </Button>
          </form>,
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
