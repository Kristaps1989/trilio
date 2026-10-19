"use client";

import type { PriceStats } from "@/domain/flow/insight";
import { PriceRange, priceScale, rangeAnswer, type CentsRange } from "@/ui/PriceRange";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  encodeState,
  withAnswer,
  withoutAnswer,
  withSetting,
  type FlowState,
  type Trailing,
} from "@/domain/flow/state";
import { Button } from "@/ui/Button";
import { OptionRow } from "@/ui/OptionRow";
import { SingleRange } from "@/ui/RangeSlider";
import { useLiveCount } from "@/ui/useLiveCount";

// Results you can adjust in place (docs/FILTERS_PLAN.md §4.1): one chip per
// choice; a chip opens a sheet (a modal dialog: focus stays inside, Esc
// closes) with the same control as the flow and a live "Rādīt N rezultātus".
// Applying navigates to the new URL, so the server re-ranks with the same
// rules and the page stays shareable.

export type SheetOption = { value: string; label: string; sublabel?: string | null; count?: number };

export type Editor =
  | {
      kind: "choice";
      questionId: string;
      multi: boolean;
      maxSelect?: number;
      options: SheetOption[];
      clearable: boolean;
    }
  | {
      kind: "range";
      questionId: string;
      unit: string;
      min: number;
      max: number;
      step: number;
      presets: number[];
    }
  | { kind: "number"; questionId: string; min: number; max: number; unit: string }
  | {
      kind: "price";
      stats: PriceStats | null;
      presetsCents: number[];
    }
  | { kind: "brands"; brands: { name: string; count: number }[] }
  | { kind: "urgency"; options: SheetOption[] }
  | { kind: "refurbished" };

export type Chip = { id: string; title: string; label: string; active: boolean; editor: Editor };

export function FilterBar({ chips, state, subId }: { chips: Chip[]; state: FlowState; subId: string }) {
  const t = useTranslations("results");
  const [open, setOpen] = useState<Chip | null>(null);
  return (
    <nav aria-label={t("filters")}>
      <ul className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => setOpen(c)}
              aria-haspopup="dialog"
              className={`flex min-h-11 items-center gap-1.5 rounded-full px-[14px] text-sm transition-colors ${
                c.active
                  ? "bg-lime-18 font-semibold text-mist ring-1 ring-lime"
                  : "bg-chip text-mist hover:bg-lime-18"
              }`}
            >
              {c.label}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      {open ? <Sheet chip={open} state={state} subId={subId} onClose={() => setOpen(null)} /> : null}
    </nav>
  );
}

function Sheet({
  chip,
  state,
  subId,
  onClose,
}: {
  chip: Chip;
  state: FlowState;
  subId: string;
  onClose: () => void;
}) {
  const t = useTranslations("results");
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [working, setWorking] = useState<FlowState>(state);
  const encoded = useMemo(() => encodeState(working), [working]);
  const { count } = useLiveCount(subId, encoded);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  function apply() {
    router.push(`/rezultati?sub=${subId}&a=${encoded}`);
    onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="sheet-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 mt-auto w-full max-w-none rounded-t-[22px] bg-night p-0 text-mist backdrop:bg-black/60 sm:m-auto sm:max-w-[560px] sm:rounded-[22px]"
    >
      <div className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto px-5 pt-5 pb-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id="sheet-title" className="font-heading text-[22px] font-semibold">
            {chip.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("sheetCancel")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line-30"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <EditorBody editor={chip.editor} working={working} setWorking={setWorking} />
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button onClick={apply} disabled={count === 0}>
            {count === null ? t("sheetShowPending") : t("sheetShow", { count })}
          </Button>
          <Button variant="link" size="md" onClick={onClose}>
            {t("sheetCancel")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function EditorBody({
  editor,
  working,
  setWorking,
}: {
  editor: Editor;
  working: FlowState;
  setWorking: (s: FlowState) => void;
}) {
  const t = useTranslations("results");
  const tf = useTranslations("flow");

  switch (editor.kind) {
    case "choice": {
      const current = working.answers[editor.questionId];
      const chosen = Array.isArray(current) ? current : typeof current === "string" ? [current] : [];
      const toggle = (v: string) => {
        if (!editor.multi) return setWorking(withAnswer(working, editor.questionId, v));
        const next = chosen.includes(v)
          ? chosen.filter((x) => x !== v)
          : [...chosen, v].slice(-(editor.maxSelect ?? 9));
        setWorking(
          next.length
            ? withAnswer(working, editor.questionId, next)
            : withoutAnswer(working, editor.questionId),
        );
      };
      return (
        <div role={editor.multi ? "group" : "radiogroup"} className="flex flex-col gap-[10px]">
          {editor.options.map((o, i) => (
            <OptionRow
              key={o.value}
              letter={"ABCDEFGHIJ"[i] ?? "•"}
              label={o.label}
              sublabel={[o.sublabel, o.count === undefined ? null : tf("count", { count: o.count })]
                .filter(Boolean)
                .join(" · ")}
              role={editor.multi ? "checkbox" : "radio"}
              selected={chosen.includes(o.value)}
              onSelect={() => toggle(o.value)}
            />
          ))}
          {editor.clearable && chosen.length ? (
            <Button
              variant="link"
              size="sm"
              onClick={() => setWorking(withoutAnswer(working, editor.questionId))}
            >
              {t("sheetClear")}
            </Button>
          ) : null}
        </div>
      );
    }
    case "range": {
      const a = working.answers[editor.questionId];
      const max = typeof a === "object" && a !== null && !Array.isArray(a) ? a.max : undefined;
      const limited = max !== undefined;
      const value = max ?? editor.presets[0] ?? editor.max;
      return (
        <div className="flex flex-col gap-3">
          <div role="radiogroup" className="flex flex-col gap-[10px]">
            <OptionRow
              letter="A"
              label={tf("noLimit")}
              selected={!limited}
              onSelect={() => setWorking(withAnswer(working, editor.questionId, {}))}
            />
            <OptionRow
              letter="B"
              label={tf("hasLimit")}
              selected={limited}
              onSelect={() => setWorking(withAnswer(working, editor.questionId, { max: value }))}
            />
          </div>
          {limited ? (
            <>
              <p className="font-heading text-[28px] font-semibold" aria-hidden="true">
                {tf("upTo", { value: String(value).replace(".", ","), unit: editor.unit })}
              </p>
              <SingleRange
                label={tf("hasLimit")}
                min={editor.min}
                max={editor.max}
                step={editor.step}
                value={value}
                onChange={(v) => setWorking(withAnswer(working, editor.questionId, { max: v }))}
                valueText={`${value} ${editor.unit}`}
              />
            </>
          ) : null}
        </div>
      );
    }
    case "number": {
      const a = working.answers[editor.questionId];
      return (
        <label className="flex flex-col gap-1 text-sm text-stone">
          {editor.unit}
          <input
            inputMode="decimal"
            defaultValue={typeof a === "number" ? String(a) : ""}
            onChange={(e) => {
              const n = Number(e.target.value.replace(",", "."));
              if (Number.isFinite(n) && n >= editor.min && n <= editor.max)
                setWorking(withAnswer(working, editor.questionId, n));
            }}
            className="min-h-11 rounded-control border-[1.5px] border-mist-32 bg-transparent px-3 text-lg font-semibold text-mist"
          />
        </label>
      );
    }
    case "price": {
      const s = editor.stats;
      const { lo, top } = priceScale(s);
      const b = working.trailing.budget;
      const range =
        typeof b === "object" && b !== null
          ? { min: b.min ?? lo, max: b.max ?? top }
          : typeof b === "number"
            ? { min: lo, max: b }
            : { min: lo, max: top };
      const set = (r: CentsRange) => {
        const a = rangeAnswer(r, s);
        setWorking(withSetting(working, "budget", a.min === undefined && a.max === undefined ? "none" : a));
      };
      return <PriceRange stats={s} value={range} onChange={set} big={false} />;
    }
    case "brands": {
      const chosen = working.trailing.brands ?? [];
      // Shops spell brands differently ("SAMSUNG", "Samsung"): compare without case.
      const isChosen = (b: string) => chosen.some((x) => x.toLowerCase() === b.toLowerCase());
      const toggle = (b: string) => {
        const next = isChosen(b) ? chosen.filter((x) => x.toLowerCase() !== b.toLowerCase()) : [...chosen, b];
        setWorking(withSetting(working, "brands", next.length ? next : undefined));
      };
      return (
        <div className="flex flex-col gap-3">
          <p className="text-[15px] text-stone">{t("brandsHint")}</p>
          <div role="group" aria-label={t("brandsChip")} className="flex flex-wrap gap-2">
            {editor.brands.map((b) => (
              <button
                key={b.name}
                type="button"
                role="checkbox"
                aria-checked={isChosen(b.name)}
                onClick={() => toggle(b.name)}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold ${isChosen(b.name) ? "bg-lime text-night" : "bg-chip text-mist hover:bg-lime-18"}`}
              >
                {b.name} <span className="font-normal opacity-80">· {b.count}</span>
              </button>
            ))}
          </div>
          {chosen.length ? (
            <label className="flex min-h-11 items-center gap-3 text-[15px]">
              <input
                type="checkbox"
                checked={!!working.trailing.brandsOnly}
                onChange={(e) =>
                  setWorking(withSetting(working, "brandsOnly", e.target.checked || undefined))
                }
                className="h-5 w-5 accent-[var(--color-lime)]"
              />
              {t("brandsOnly")}
            </label>
          ) : null}
        </div>
      );
    }
    case "urgency": {
      const current = working.trailing.urgency ?? "two_weeks";
      return (
        <div role="radiogroup" className="flex flex-col gap-[10px]">
          {editor.options.map((o, i) => (
            <OptionRow
              key={o.value}
              letter={"ABC"[i] ?? "•"}
              label={o.label}
              sublabel={o.sublabel}
              selected={current === o.value}
              onSelect={() => setWorking(withSetting(working, "urgency", o.value as Trailing["urgency"]))}
            />
          ))}
        </div>
      );
    }
    case "refurbished": {
      const on = working.trailing.refurbished !== "no";
      return (
        <div role="radiogroup" className="flex flex-col gap-[10px]">
          <OptionRow
            letter="A"
            label={t("refurbOn")}
            selected={on}
            onSelect={() => setWorking(withSetting(working, "refurbished", "yes"))}
          />
          <OptionRow
            letter="B"
            label={t("refurbOff")}
            selected={!on}
            onSelect={() => setWorking(withSetting(working, "refurbished", "no"))}
          />
        </div>
      );
    }
  }
}
