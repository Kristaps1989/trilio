"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { formatEur, formatEurDelta } from "@/i18n/format";
import { PrimaryButton } from "@/ui/PrimaryButton";
import { deleteRadarAction, updateRadarAction } from "./actions";

// Spec §5.2 per tracked item: pause/resume, price and change, 30-day
// sparkline, model/EAN, filters panel with summary line, stop with undo.

export type RadarCardModel = {
  id: string;
  name: string;
  brand: string;
  modelCode: string;
  ean: string | null;
  paused: boolean;
  threshold: "any" | "5" | "10";
  scope: "only" | "brand" | "any";
  storeIds: string[];
  includeRefurbished: boolean;
  channels: ("push" | "email")[];
  currentPriceCents: number | null;
  currentStoreName: string | null;
  baselinePriceCents: number | null;
  sparkline: { day: string; priceCents: number }[];
};

export function Sparkline({
  points,
  label,
}: {
  points: { day: string; priceCents: number }[];
  label: string;
}) {
  if (points.length < 2) return null;
  const w = 160;
  const h = 40;
  const min = Math.min(...points.map((p) => p.priceCents));
  const max = Math.max(...points.map((p) => p.priceCents));
  const span = max - min || 1;
  const d = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * w).toFixed(1)},${(h - ((p.priceCents - min) / span) * (h - 4) - 2).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} className="text-lime">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function RadarCard({
  radar,
  stores,
}: {
  radar: RadarCardModel;
  stores: { id: string; name: string }[];
}) {
  const t = useTranslations("radar");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [form, setForm] = useState({
    threshold: radar.threshold,
    scope: radar.scope,
    storeIds: radar.storeIds,
    includeRefurbished: radar.includeRefurbished,
    channels: radar.channels,
  });

  const summary = t("summary", {
    threshold: t(
      radar.threshold === "any" ? "thresholdAny" : radar.threshold === "5" ? "threshold5" : "threshold10",
    ),
    stores: radar.storeIds.length === 0 ? t("allStores") : t("storesCount", { count: radar.storeIds.length }),
    scope:
      radar.scope === "only"
        ? t("scopeOnlyShort")
        : radar.scope === "brand"
          ? t("scopeBrandShort", { brand: radar.brand })
          : t("scopeAnyShort"),
  });

  function togglePause() {
    start(async () => {
      await updateRadarAction({ radarId: radar.id, paused: !radar.paused });
      router.refresh();
    });
  }

  function stop() {
    start(async () => {
      if (await deleteRadarAction(radar.id)) setDeleted(true);
    });
  }

  function undo() {
    start(async () => {
      await deleteRadarAction(radar.id, true);
      setDeleted(false);
      router.refresh();
    });
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const ok = await updateRadarAction({ radarId: radar.id, ...form, storeIds: form.storeIds });
      if (ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (deleted) {
    return (
      <div
        role="status"
        className="flex items-center justify-between gap-3 rounded-card bg-white-5 p-4 text-mist"
      >
        <span>{t("stopped")}</span>
        <button type="button" onClick={undo} className="min-h-11 rounded-xl px-3 font-semibold text-lime">
          {t("undo")}
        </button>
      </div>
    );
  }

  const delta =
    radar.currentPriceCents !== null && radar.baselinePriceCents !== null
      ? radar.currentPriceCents - radar.baselinePriceCents
      : null;

  return (
    <article
      className="flex flex-col gap-3 rounded-card bg-white p-[22px] text-night"
      aria-label={radar.name}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold leading-tight">{radar.name}</h3>
          <p className="text-sm text-muted">
            {radar.modelCode} · EAN {radar.ean ?? "—"}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!radar.paused}
          aria-label={radar.paused ? t("resume") : t("pause")}
          disabled={pending}
          onClick={togglePause}
          className={`flex h-11 min-w-[72px] items-center justify-center rounded-full border px-3 text-sm font-bold ${
            radar.paused ? "border-muted text-muted" : "border-night bg-night text-lime"
          }`}
        >
          {radar.paused ? t("paused") : t("resume")}
        </button>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          {radar.currentPriceCents !== null ? (
            <>
              <p className="font-heading text-2xl font-bold">
                {t("priceNow", { price: formatEur(radar.currentPriceCents) })}
                {radar.currentStoreName ? (
                  <span className="text-base font-semibold text-muted"> · {radar.currentStoreName}</span>
                ) : null}
              </p>
              {delta !== null ? (
                <p className={`text-sm font-semibold ${delta < 0 ? "text-refurb" : "text-muted"}`}>
                  {t("priceChange", { delta: formatEurDelta(delta) })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-base text-muted">{t("noOffer")}</p>
          )}
        </div>
        <Sparkline points={radar.sparkline} label={t("sparkline")} />
      </div>

      <div className="rounded-xl bg-best p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p>
            <span className="font-semibold">{t("filters")}</span> — {summary}
          </p>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            className="min-h-11 px-2 font-semibold text-refurb"
          >
            {t("change")}
          </button>
        </div>
        {editing ? (
          <form onSubmit={save} className="mt-3 flex flex-col gap-3">
            <fieldset className="flex flex-col gap-1">
              <legend className="font-semibold">{t("qWhen")}</legend>
              {(["any", "5", "10"] as const).map((v) => (
                <label key={v} className="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="threshold"
                    checked={form.threshold === v}
                    onChange={() => setForm({ ...form, threshold: v })}
                    className="h-5 w-5 accent-night"
                  />
                  {t(v === "any" ? "whenAny" : v === "5" ? "when5" : "when10")}
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-col gap-1">
              <legend className="font-semibold">{t("stores")}</legend>
              {stores.map((s) => {
                const checked = form.storeIds.length === 0 || form.storeIds.includes(s.id);
                return (
                  <label key={s.id} className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const all = stores.map((x) => x.id);
                        const current = form.storeIds.length === 0 ? all : form.storeIds;
                        const next = e.target.checked
                          ? [...new Set([...current, s.id])]
                          : current.filter((id) => id !== s.id);
                        // At least one store must stay selected (spec §5.2).
                        if (next.length === 0) return;
                        setForm({ ...form, storeIds: next.length === all.length ? [] : next });
                      }}
                      className="h-5 w-5 accent-night"
                    />
                    {s.name}
                  </label>
                );
              })}
            </fieldset>
            <fieldset className="flex flex-col gap-1">
              <legend className="font-semibold">{t("qScope")}</legend>
              {(["only", "brand", "any"] as const).map((v) => (
                <label key={v} className="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="scope"
                    checked={form.scope === v}
                    onChange={() => setForm({ ...form, scope: v })}
                    className="h-5 w-5 accent-night"
                  />
                  {v === "only"
                    ? t("scopeOnly")
                    : v === "brand"
                      ? t("scopeBrand", { brand: radar.brand })
                      : t("scopeAny")}
                </label>
              ))}
            </fieldset>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={form.includeRefurbished}
                onChange={(e) => setForm({ ...form, includeRefurbished: e.target.checked })}
                className="h-5 w-5 accent-night"
              />
              {t("includeRefurbished")}
            </label>
            <fieldset className="flex flex-col gap-1">
              <legend className="font-semibold">{t("channels")}</legend>
              {(["push", "email"] as const).map((c) => (
                <label key={c} className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.channels.includes(c)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...new Set([...form.channels, c])]
                        : form.channels.filter((x) => x !== c);
                      if (next.length === 0) return;
                      setForm({ ...form, channels: next });
                    }}
                    className="h-5 w-5 accent-night"
                  />
                  {c === "push" ? t("channelPush") : t("channelEmail")}
                </label>
              ))}
            </fieldset>
            <PrimaryButton type="submit" variant="light" disabled={pending}>
              {t("save")}
            </PrimaryButton>
          </form>
        ) : null}
      </div>

      <button
        type="button"
        onClick={stop}
        disabled={pending}
        className="min-h-11 self-start rounded-xl px-2 text-sm font-semibold text-over-text"
      >
        {t("stop")}
      </button>
    </article>
  );
}
