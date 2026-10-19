"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { formatEur, formatEurDelta } from "@/i18n/format";
import { Button } from "@/ui/Button";
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
  muted = false,
}: {
  points: { day: string; priceCents: number }[];
  label: string;
  /** Grey line (paused radar). */
  muted?: boolean;
}) {
  if (points.length < 2) return null;
  const w = 320;
  const h = 70;
  const min = Math.min(...points.map((p) => p.priceCents));
  const max = Math.max(...points.map((p) => p.priceCents));
  const span = max - min || 1;
  const coords = points
    .map(
      (p, i) =>
        `${((i / (points.length - 1)) * w).toFixed(1)},${(h - ((p.priceCents - min) / span) * (h - 8) - 4).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={muted ? "text-muted" : "text-night"}
    >
      <polyline
        points={coords}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** On/off switch from the radar prototype (56 × 32 track). */
export function Switch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative flex h-11 w-14 shrink-0 items-center rounded-full ${checked ? "justify-end" : "justify-start"}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 top-1.5 h-8 rounded-full ${checked ? "bg-night" : "bg-switch-off"}`}
      />
      <span
        aria-hidden="true"
        className={`relative mx-[3px] h-[26px] w-[26px] rounded-full ${checked ? "bg-lime" : "bg-white"}`}
      />
    </button>
  );
}

/** A filter choice as a chip (prototype); radio or checkbox semantics. */
function Chip({
  role,
  checked,
  onClick,
  children,
}: {
  role: "radio" | "checkbox";
  checked: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center rounded-full border-[1.5px] px-4 text-[15px] font-semibold ${
        checked ? "border-night bg-night text-white" : "border-chip-line bg-transparent text-night"
      }`}
    >
      {children}
    </button>
  );
}

function ChipGroup({
  label,
  hint,
  role,
  children,
}: {
  label: string;
  hint?: string;
  role: "radiogroup" | "group";
  children: React.ReactNode;
}) {
  return (
    <div role={role} aria-label={label} className="flex flex-col gap-2">
      <p className="text-[15px] font-bold">{label}</p>
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
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
  const [saved, setSaved] = useState(false);
  const [storeError, setStoreError] = useState(false);
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
        setSaved(true);
        router.refresh();
      }
    });
  }

  if (deleted) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-[10px] rounded-[14px] bg-chip px-4 py-3 text-base text-mist"
      >
        <span>{t("stopped")}</span>
        <Button size="sm" onClick={undo}>
          {t("undo")}
        </Button>
      </div>
    );
  }

  const delta =
    radar.currentPriceCents !== null && radar.baselinePriceCents !== null
      ? radar.currentPriceCents - radar.baselinePriceCents
      : null;
  const on = !radar.paused;

  return (
    <article
      className={`flex flex-col gap-[14px] rounded-panel-lg bg-white p-[22px] text-night transition-opacity ${
        on ? "" : "opacity-[0.62]"
      } ${on && delta !== null && delta < 0 ? "shadow-[0_0_0_3px_var(--color-lime)]" : ""}`}
      aria-label={radar.name}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {on && delta !== null && delta < 0 ? (
            <span className="inline-flex rounded-full bg-lime px-3 py-[5px] text-[13px] font-bold">
              {t("dropped")}
            </span>
          ) : null}
          <span className="text-sm text-muted">{radar.paused ? t("paused") : t("watching")}</span>
        </div>
        <Switch
          checked={on}
          label={radar.paused ? t("resume") : t("pause")}
          disabled={pending}
          onChange={togglePause}
        />
      </div>

      <div>
        <h2 className="font-body text-xl font-bold tracking-normal">{radar.name}</h2>
        <p className="mt-1 font-heading text-[13px] font-semibold tracking-[0.01em]">
          {radar.modelCode} · EAN {radar.ean ?? "—"}
        </p>
      </div>

      {radar.currentPriceCents !== null ? (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-heading text-[38px] leading-none font-bold tracking-[-0.02em]">
            <span className="sr-only">{t("priceNow", { price: "" })}</span>
            {formatEur(radar.currentPriceCents)}
          </span>
          {radar.currentStoreName ? (
            <span className="text-base font-semibold">{radar.currentStoreName}</span>
          ) : null}
          {delta !== null ? (
            <span className={`text-[15px] font-bold ${delta < 0 ? "text-success" : "text-muted"}`}>
              {t("priceChange", { delta: formatEurDelta(delta) })}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="text-base text-muted">{t("noOffer")}</p>
      )}

      {radar.sparkline.length > 1 ? (
        <div>
          <Sparkline points={radar.sparkline} label={t("sparkline")} muted={!on} />
          <div className="flex justify-between text-[13px] text-muted">
            <span>{t("days30ago")}</span>
            <span>{t("today")}</span>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setEditing((v) => !v);
          setSaved(false);
        }}
        aria-expanded={editing}
        className="flex min-h-[52px] items-center justify-between gap-3 rounded-control border-[1.5px] border-card-button-line px-[14px] py-[10px] text-left"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-bold">{t("filters")}</span>
          <span className="text-sm text-muted">{summary}</span>
        </span>
        <span className="shrink-0 text-sm font-bold">{editing ? t("close") : t("change")}</span>
      </button>

      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-4 rounded-[14px] bg-card-soft p-4">
          <ChipGroup label={t("qWhen")} role="radiogroup">
            {(["any", "5", "10"] as const).map((v) => (
              <Chip
                key={v}
                role="radio"
                checked={form.threshold === v}
                onClick={() => setForm({ ...form, threshold: v })}
              >
                {t(v === "any" ? "whenAny" : v === "5" ? "when5" : "when10")}
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup label={t("stores")} role="group">
            {stores.map((s) => {
              const checked = form.storeIds.length === 0 || form.storeIds.includes(s.id);
              return (
                <Chip
                  key={s.id}
                  role="checkbox"
                  checked={checked}
                  onClick={() => {
                    const all = stores.map((x) => x.id);
                    const current = form.storeIds.length === 0 ? all : form.storeIds;
                    const next = checked
                      ? current.filter((id) => id !== s.id)
                      : [...new Set([...current, s.id])];
                    // At least one store must stay selected (spec §5.2).
                    if (next.length === 0) {
                      setStoreError(true);
                      return;
                    }
                    setStoreError(false);
                    setForm({ ...form, storeIds: next.length === all.length ? [] : next });
                  }}
                >
                  {s.name}
                </Chip>
              );
            })}
          </ChipGroup>
          <ChipGroup label={t("qScope")} hint={t("scopeWhy")} role="radiogroup">
            {(["only", "brand", "any"] as const).map((v) => (
              <Chip
                key={v}
                role="radio"
                checked={form.scope === v}
                onClick={() => setForm({ ...form, scope: v })}
              >
                {v === "only"
                  ? t("scopeOnly")
                  : v === "brand"
                    ? t("scopeBrand", { brand: radar.brand })
                    : t("scopeAny")}
              </Chip>
            ))}
          </ChipGroup>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px]">
              <strong className="block font-bold">{t("includeRefurbished")}</strong>
              <span className="text-muted">{t("refurbishedNote")}</span>
            </span>
            <Switch
              checked={form.includeRefurbished}
              label={t("includeRefurbished")}
              onChange={() => setForm({ ...form, includeRefurbished: !form.includeRefurbished })}
            />
          </div>
          {storeError ? <p className="text-sm font-semibold text-danger-ink">{t("storeRequired")}</p> : null}
          <div>
            <Button type="submit" variant="dark" disabled={pending}>
              {t("saveFilters")}
            </Button>
          </div>
        </form>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm font-bold text-success">
          {t("filtersSaved")}
        </p>
      ) : null}

      {radar.paused ? <p className="text-[15px] font-semibold">{t("pausedNote")}</p> : null}

      <div className="flex flex-wrap gap-[10px]">
        <Button variant="card" onClick={stop} disabled={pending}>
          {t("stop")}
        </Button>
      </div>
    </article>
  );
}
