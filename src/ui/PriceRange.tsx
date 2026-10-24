"use client";

import { useTranslations } from "next-intl";
import { useUiLocale } from "@/i18n/useUiLocale";
import type { PriceStats } from "@/domain/flow/insight";
import { formatEur } from "@/i18n/format";
import { DualRange, Histogram } from "./RangeSlider";

// The price range editor shared by the price screen and the results-page
// sheet (owner, 19 Oct 2026): it opens around the category's typical price,
// the slider ignores rare outliers so close prices stay apart, and "+" steps
// sized to the category widen the upper limit in one tap.

export type CentsRange = { min: number; max: number };

/** Slider ends and the true price span for a category (cents). */
export function priceScale(stats: PriceStats | null) {
  const step = stats?.stepCents ?? 1000;
  const lo = stats ? Math.floor(stats.minCents / step) * step : 0;
  const hi = stats ? Math.max(lo + step, stats.scaleMaxCents) : 100_000;
  const top = stats ? Math.max(hi, Math.ceil(stats.maxCents / step) * step) : hi;
  return { step, lo, hi, top };
}

/** The stored answer: limits at the ends of what is on offer are no limit. */
export function rangeAnswer(range: CentsRange, stats: PriceStats | null): { min?: number; max?: number } {
  const { lo, top } = priceScale(stats);
  return { min: range.min > lo ? range.min : undefined, max: range.max < top ? range.max : undefined };
}

/** "+" steps that matter for the category: €10–50 for kettles, €50–500 for fridges. */
export function widenSteps(stats: PriceStats | null): number[] {
  const typical = stats ? (stats.defaultMinCents + stats.defaultMaxCents) / 2 : 50_000;
  if (typical < 10_000) return [1000, 2000, 5000];
  if (typical < 30_000) return [2000, 5000, 10_000];
  return [5000, 10_000, 50_000];
}

export function PriceRange({
  stats,
  value,
  onChange,
  big = true,
}: {
  stats: PriceStats | null;
  value: CentsRange;
  onChange: (r: CentsRange) => void;
  big?: boolean;
}) {
  const t = useTranslations("budget");
  const locale = useUiLocale();
  const { step, lo, hi, top } = priceScale(stats);

  function setField(key: "min" | "max", text: string) {
    const eur = Number(text.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(eur)) return;
    const cents = Math.round(eur) * 100;
    onChange(
      key === "min"
        ? { min: Math.min(Math.max(lo, cents), value.max), max: value.max }
        : { min: value.min, max: Math.max(Math.min(top, cents), value.min) },
    );
  }

  return (
    <div className="flex max-w-[620px] flex-col gap-3">
      <p
        className={`font-heading font-semibold text-mist ${big ? "text-[clamp(28px,5vw,40px)]" : "text-[28px]"}`}
        aria-hidden="true"
      >
        {t("range", { min: formatEur(value.min, locale), max: formatEur(value.max, locale) })}
      </p>
      {stats ? (
        <Histogram
          buckets={stats.buckets}
          min={stats.minCents}
          max={stats.scaleMaxCents}
          value={{ min: value.min, max: Math.min(value.max, hi) }}
          description={t("histogram", {
            min: formatEur(stats.minCents, locale),
            max: formatEur(stats.maxCents, locale),
          })}
        />
      ) : null}
      {/* The slider spans the usual prices; an upper limit above it sits at the right end. */}
      <DualRange
        labels={{ min: t("minLabel"), max: t("maxLabel") }}
        min={lo}
        max={hi}
        step={step}
        value={{ min: Math.min(value.min, hi - step), max: Math.min(value.max, hi) }}
        onChange={(r) => onChange({ min: r.min, max: r.max >= hi && value.max > hi ? value.max : r.max })}
        valueText={(v) => formatEur(v, locale)}
      />
      <div className="flex gap-3">
        {(["min", "max"] as const).map((key) => (
          <label key={key} className="flex flex-1 flex-col gap-1 text-sm text-stone">
            {key === "min" ? t("from") : t("to")}
            <span className="flex items-center gap-2 rounded-control border-[1.5px] border-mist-32 px-3">
              <input
                inputMode="numeric"
                aria-label={key === "min" ? t("minLabel") : t("maxLabel")}
                value={String(Math.round(value[key] / 100))}
                onChange={(e) => setField(key, e.target.value)}
                className="min-h-11 w-full bg-transparent text-lg font-semibold text-mist outline-none"
              />
              <span aria-hidden="true">€</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-stone">{t("widenBy")}</span>
        {widenSteps(stats).map((d) => (
          <button
            key={d}
            type="button"
            aria-label={t("widenByAria", { amount: formatEur(d, locale) })}
            disabled={value.max >= top}
            onClick={() => onChange({ min: value.min, max: Math.min(top, value.max + d) })}
            className="min-h-11 rounded-full bg-chip px-4 text-sm font-semibold text-mist hover:bg-lime-18 disabled:opacity-40"
          >
            +{formatEur(d, locale)}
          </button>
        ))}
      </div>
    </div>
  );
}
