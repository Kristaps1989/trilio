"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { encodeState, withAnswer, type FlowState } from "@/domain/flow/state";
import { OptionRow } from "@/ui/OptionRow";
import { PrimaryButton } from "@/ui/PrimaryButton";

// One question per screen (spec §2). Single choice auto-advances after
// ~260 ms; multi and number inputs use "Turpināt". State goes into the URL,
// so the browser's back button is the flow's back button.

export type ScreenOption = { value: string; label: string; sublabel?: string | null; exclusive?: boolean };

export type ScreenQuestion = {
  id: string;
  title: string;
  why?: string | null;
  help?: string | null;
  type: "single" | "multi" | "number";
  maxSelect?: number;
  input?: { min: number; max: number; default: number; unit: string; step: number };
  options: ScreenOption[];
  /** Budget only: the "Cita summa" option reveals a euro input. */
  customNumber?: { optionValue: string; label: string; min: number; max: number };
};

const AUTO_ADVANCE_MS = 260;
const LETTERS = "ABCDEFGHIJKLMNOP";

export function QuestionScreen({
  question,
  state,
  basePath,
}: {
  question: ScreenQuestion;
  state: FlowState;
  basePath: string;
}) {
  const t = useTranslations("flow");
  const router = useRouter();
  const current = state.answers[question.id] ?? (state.trailing as Record<string, unknown>)[question.id];
  const [multi, setMulti] = useState<string[]>(Array.isArray(current) ? current : []);
  const [number, setNumber] = useState<string>(
    typeof current === "number" ? String(current) : question.input ? String(question.input.default) : "",
  );
  const [flash, setFlash] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function go(value: unknown) {
    const next = withAnswer(state, question.id, value);
    router.push(`${basePath}?a=${encodeState(next)}`);
  }

  function pickSingle(value: string) {
    if (question.customNumber && value === question.customNumber.optionValue) {
      setCustomOpen(true);
      setFlash(value);
      return;
    }
    setFlash(value);
    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timer.current = setTimeout(() => go(value), reduced ? 0 : AUTO_ADVANCE_MS);
  }

  function toggleMulti(opt: ScreenOption) {
    setMulti((prev) => {
      if (opt.exclusive) return prev.includes(opt.value) ? [] : [opt.value];
      const without = prev.filter(
        (v) => v !== opt.value && !question.options.find((o) => o.value === v)?.exclusive,
      );
      if (prev.includes(opt.value)) return without;
      if (without.length >= (question.maxSelect ?? 1)) return without;
      return [...without, opt.value];
    });
  }

  function submitNumber() {
    const n = Number(number.replace(",", "."));
    const { min, max } = question.input!;
    if (!Number.isFinite(n) || n < min || n > max) {
      setError(t("numberHint", { min, max }));
      return;
    }
    go(n);
  }

  function submitCustom() {
    const n = Math.round(Number(customValue.replace(",", ".")));
    const { min, max } = question.customNumber!;
    if (!Number.isFinite(n) || n < min || n > max) {
      setError(t("numberHint", { min, max }));
      return;
    }
    go(n * 100);
  }

  return (
    <div className="flex flex-1 flex-col gap-6 pt-4">
      <h1 className="text-[28px] font-bold leading-[1.2] text-mist">{question.title}</h1>

      {question.type === "number" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitNumber();
          }}
        >
          <label className="flex flex-col gap-2 text-base font-semibold text-mist">
            <span>{t("numberHint", { min: question.input!.min, max: question.input!.max })}</span>
            <span className="flex items-center gap-2">
              <input
                name="value"
                inputMode="decimal"
                enterKeyHint="go"
                autoFocus
                value={number}
                onChange={(e) => {
                  setNumber(e.target.value);
                  setError(null);
                }}
                className="min-h-14 w-full rounded-[14px] border-[1.5px] border-mist-32 bg-white-5 px-4 text-xl text-mist"
                aria-invalid={!!error}
                aria-describedby={error ? "number-error" : undefined}
              />
              <span className="text-lg text-stone">{question.input!.unit}</span>
            </span>
          </label>
          {error ? (
            <p id="number-error" className="text-sm text-warning">
              {error}
            </p>
          ) : null}
          <PrimaryButton type="submit">{t("continue")}</PrimaryButton>
        </form>
      ) : (
        <div
          role={question.type === "multi" ? "group" : "radiogroup"}
          aria-label={question.title}
          className="flex flex-col gap-2"
        >
          {question.type === "multi" ? (
            <p className="text-sm text-stone">{t("pickUpTo", { max: question.maxSelect ?? 1 })}</p>
          ) : null}
          {question.options.map((o, i) => (
            <OptionRow
              key={o.value}
              letter={LETTERS[i] ?? "•"}
              label={o.label}
              sublabel={o.sublabel}
              role={question.type === "multi" ? "checkbox" : "radio"}
              selected={
                question.type === "multi" ? multi.includes(o.value) : flash === o.value || current === o.value
              }
              onSelect={() => (question.type === "multi" ? toggleMulti(o) : pickSingle(o.value))}
            />
          ))}
          {customOpen && question.customNumber ? (
            <form
              className="mt-2 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitCustom();
              }}
            >
              <label className="flex flex-col gap-2 text-base font-semibold text-mist">
                <span>{question.customNumber.label}</span>
                <span className="flex items-center gap-2">
                  <input
                    name="custom"
                    inputMode="numeric"
                    enterKeyHint="go"
                    autoFocus
                    value={customValue}
                    onChange={(e) => {
                      setCustomValue(e.target.value);
                      setError(null);
                    }}
                    className="min-h-14 w-full rounded-[14px] border-[1.5px] border-mist-32 bg-white-5 px-4 text-xl text-mist"
                  />
                  <span className="text-lg text-stone">€</span>
                </span>
              </label>
              {error ? <p className="text-sm text-warning">{error}</p> : null}
              <PrimaryButton type="submit">{t("continue")}</PrimaryButton>
            </form>
          ) : null}
          {question.type === "multi" ? (
            <PrimaryButton className="mt-2" disabled={multi.length === 0} onClick={() => go(multi)}>
              {t("continue")}
            </PrimaryButton>
          ) : null}
        </div>
      )}

      {question.help ? (
        <div>
          <button
            type="button"
            className="min-h-11 text-base font-semibold text-lime underline-offset-4 hover:underline"
            aria-expanded={showHelp}
            onClick={() => setShowHelp((v) => !v)}
          >
            {t("dontKnow")}
          </button>
          {showHelp ? <p className="mt-2 text-base text-stone">{question.help}</p> : null}
        </div>
      ) : null}

      {question.why ? (
        <p className="text-sm text-stone">
          <span className="font-semibold text-mist">{t("why")}</span> {question.why}
        </p>
      ) : null}
    </div>
  );
}
