import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { formatInt } from "@/i18n/format";
import { adsProvider } from "@/services/ads";
import { adsOverview } from "@/services/ads/overview";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../guard";
import { AdminTitle, Chip, inputClass, labelClass, Section, Stat, Stats } from "../ui";
import {
  buildCampaignsAction,
  runOptimiserAction,
  saveAdSettingsAction,
  setCampaignStatusAction,
  syncAdsAction,
  togglePauseAdsAction,
} from "./actions";
import { AdsNav, eurFromCents, eurFromMicros, Outcome } from "./shared";

// Reklāma → Pārskats (docs/GROWTH_PLAN.md §6): the owner's one number, the
// mode, pause-all, this week's numbers and the optimiser's last word.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reklāma" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const euroInput = (cents: number | null) =>
  cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");

export default async function AdsOverview({ searchParams }: Props) {
  await requireAdmin("/admin/reklama");
  const t = await getTranslations("admin.ads");
  const sp = await searchParams;
  const provider = adsProvider();
  const o = await adsOverview(db);
  const s = o.settings;
  const split = (v?: string) => (v ?? "").split("/");
  const ok = sp.ok
    ? t("saved")
    : sp.built
      ? t("built", {
          campaigns: split(sp.built)[0]!,
          groups: split(sp.built)[1]!,
          keywords: split(sp.built)[2]!,
        })
      : sp.synced
        ? t("synced", { created: split(sp.synced)[0]!, failed: split(sp.synced)[1]! })
        : sp.enabled
          ? t("enabled", { count: sp.enabled })
          : sp.ran
            ? t("ran", {
                proposals: split(sp.ran)[0]!,
                applied: split(sp.ran)[1]!,
                blocked: split(sp.ran)[2]!,
              })
            : null;
  const err = sp.err?.startsWith("run:") ? t("ranFailed", { reason: sp.err.slice(4) }) : (sp.err ?? null);

  return (
    <>
      <AdminTitle title={t("title")} sub={t("sub")} />
      <AdsNav active="overview" />
      <Outcome ok={ok} err={err} />
      <p className="text-[15px] text-stone" data-ads-provider={provider?.name ?? "off"}>
        {provider
          ? t("provider", { name: provider.name === "google" ? t("providerGoogle") : t("providerMock") })
          : t("providerOff")}
      </p>
      {s.paused ? (
        <p className="font-semibold text-warning" data-ads-paused>
          {t("paused")}
        </p>
      ) : null}

      <div data-ad-conversions={`${o.perf.shopClicks7d}/${o.perf.saves7d}`} className="contents">
        <Stats>
          <Stat label={t("statSpend7")} value={eurFromMicros(o.week.micros)} />
          <Stat label={t("statSpendMonth")} value={eurFromMicros(o.month.micros)} />
          <Stat label={t("statClicks7")} value={formatInt(o.week.clicks)} />
          <Stat label={t("statShop7")} value={formatInt(o.perf.shopClicks7d)} />
          <Stat label={t("statSaves7")} value={formatInt(o.perf.saves7d)} />
          <Stat
            label={t("statCpa")}
            value={o.cpa === null ? "—" : eurFromCents(o.cpa)}
            hint={
              s.targetCostCents === null
                ? t("statNoTarget")
                : t("statTarget", { amount: eurFromCents(s.targetCostCents) })
            }
          />
        </Stats>
      </div>

      <Section title={t("settings")} id="ads-settings">
        <form action={saveAdSettingsAction} className="grid max-w-2xl gap-3 sm:grid-cols-2" data-ads-settings>
          <label className={labelClass}>
            {t("dailyBudget")}
            <input
              name="daily"
              inputMode="decimal"
              defaultValue={euroInput(s.dailyBudgetCents)}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            {t("floor")}
            <input
              name="floor"
              inputMode="decimal"
              defaultValue={euroInput(s.floorCents)}
              className={inputClass}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            {t("target")}
            <input
              name="target"
              inputMode="decimal"
              defaultValue={euroInput(s.targetCostCents)}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            {t("clickWeight")}
            <input
              name="clickWeight"
              inputMode="numeric"
              defaultValue={s.clickWeight}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            {t("saveWeight")}
            <input name="saveWeight" inputMode="numeric" defaultValue={s.saveWeight} className={inputClass} />
          </label>
          <fieldset className="flex flex-col gap-1 sm:col-span-2">
            <legend className="mb-1 text-[15px] font-semibold text-mist">{t("mode")}</legend>
            {(["observe", "approve", "auto"] as const).map((m) => (
              <label key={m} className="flex min-h-11 items-center gap-3 text-[15px] text-mist">
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  defaultChecked={s.mode === m}
                  className="h-5 w-5 accent-lime"
                />
                {t(m === "observe" ? "modeObserve" : m === "approve" ? "modeApprove" : "modeAuto")}
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-[15px] font-semibold text-mist">{t("reviewCadence")}</legend>
            {(["weekly", "daily"] as const).map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-3 text-[15px] text-mist">
                <input
                  type="radio"
                  name="reviewCadence"
                  value={c}
                  defaultChecked={s.reviewCadence === c}
                  className="h-5 w-5 accent-lime"
                />
                {t(c === "weekly" ? "reviewWeekly" : "reviewDaily")}
              </label>
            ))}
          </fieldset>
          <label className={labelClass}>
            {t("reviewWeekday")}
            <select name="reviewWeekday" defaultValue={s.reviewWeekday} className={inputClass}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>
                  {t(`weekday${d}`)}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[15px] text-stone sm:col-span-2" data-next-review={o.nextReview}>
            {t("reviewNote", { date: o.nextReview.split("-").reverse().join(".") })}
          </p>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm">
              {t("saveSettings")}
            </Button>
          </div>
        </form>
      </Section>

      <Section title={t("steps")} id="ads-steps">
        <div className="flex flex-wrap gap-2">
          <form action={buildCampaignsAction}>
            <Button type="submit" variant="outline" size="sm">
              {t("build")}
            </Button>
          </form>
          <form action={syncAdsAction}>
            <Button type="submit" variant="outline" size="sm" disabled={!provider}>
              {t("sync")}
            </Button>
          </form>
          <form action={setCampaignStatusAction}>
            <input type="hidden" name="status" value="enabled" />
            <Button type="submit" variant="outline" size="sm" disabled={!provider || s.paused}>
              {t("enableAll")}
            </Button>
          </form>
          <form action={runOptimiserAction}>
            <Button type="submit" variant="outline" size="sm" disabled={!provider}>
              {t("runNow")}
            </Button>
          </form>
          <form action={togglePauseAdsAction}>
            <Button type="submit" variant={s.paused ? "primary" : "danger"} size="sm">
              {s.paused ? t("resume") : t("pauseAll")}
            </Button>
          </form>
        </div>
      </Section>

      <Section title={t("lastRun")} id="ads-last-run">
        {o.lastRun ? (
          <div className="flex flex-col gap-1 text-[15px] text-mist" data-last-run>
            <p>
              {o.lastRun.day} ·{" "}
              {o.lastRun.ok ? (
                <Chip tone="lime">OK</Chip>
              ) : (
                <Chip tone="warning">{o.lastRun.error ?? "—"}</Chip>
              )}
            </p>
            {o.lastRun.summary ? <p className="text-stone">{o.lastRun.summary}</p> : null}
          </div>
        ) : (
          <p className="text-[15px] text-stone">{t("noRun")}</p>
        )}
      </Section>
    </>
  );
}
