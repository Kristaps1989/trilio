"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { encodeState, withAnswer, type FlowState } from "@/domain/flow/state";
import { OptionRow } from "@/ui/OptionRow";
import { Button } from "@/ui/Button";
import { InfoBox, PageTitle } from "@/ui/layout";

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

  const helpToggle = question.help ? (
    <Button
      variant="link"
      size="md"
      aria-expanded={showHelp}
      aria-controls={`help-${question.id}`}
      onClick={() => setShowHelp((v) => !v)}
    >
      {t("dontKnow")}
    </Button>
  ) : null;

  const bigInput =
    "min-w-0 flex-1 border-0 border-b-2 border-lime bg-transparent py-2 font-heading text-[clamp(24px,4vw,36px)] font-semibold text-mist outline-none placeholder:text-stone/60";

  return (
    <>
      <PageTitle>{question.title}</PageTitle>

      {question.type === "number" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitNumber();
          }}
        >
          <div className="mt-1.5 flex max-w-[560px] items-end gap-3">
            <label htmlFor={`answer-${question.id}`} className="sr-only">
              {question.title}
            </label>
            <input
              id={`answer-${question.id}`}
              name="value"
              inputMode="decimal"
              enterKeyHint="go"
              autoFocus
              value={number}
              onChange={(e) => {
                setNumber(e.target.value);
                setError(null);
              }}
              className={bigInput}
              aria-invalid={!!error}
              aria-describedby={`number-hint-${question.id}${error ? " number-error" : ""}`}
            />
            <span className="pb-2.5 font-heading text-[clamp(22px,3.4vw,30px)] font-semibold text-stone">
              {question.input!.unit}
            </span>
          </div>
          <p id={`number-hint-${question.id}`} className="text-[15px] text-stone">
            {t("numberHint", { min: question.input!.min, max: question.input!.max })}
          </p>
          {error ? (
            <p id="number-error" className="text-[15px] text-warning" role="alert">
              {error}
            </p>
          ) : null}
          {showHelp && question.help ? <HelpBox id={`help-${question.id}`}>{question.help}</HelpBox> : null}
          <div className="mt-1 flex flex-wrap items-center gap-[14px]">
            <Button type="submit">{t("continue")}</Button>
            {helpToggle}
          </div>
        </form>
      ) : (
        <div
          role={question.type === "multi" ? "group" : "radiogroup"}
          aria-label={question.title}
          className="mt-1.5 flex max-w-[540px] flex-col gap-[10px]"
        >
          {question.type === "multi" ? (
            <p className="text-[15px] text-stone">{t("pickUpTo", { max: question.maxSelect ?? 1 })}</p>
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
              analytics={{
                event: "answer_question",
                params: { question: question.id, option: String(o.value) },
              }}
            />
          ))}
          {customOpen && question.customNumber ? (
            <form
              className="mt-3 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitCustom();
              }}
            >
              <div className="flex items-end gap-3">
                <label htmlFor={`custom-${question.id}`} className="sr-only">
                  {question.customNumber.label}
                </label>
                <input
                  id={`custom-${question.id}`}
                  name="custom"
                  inputMode="numeric"
                  enterKeyHint="go"
                  autoFocus
                  placeholder={question.customNumber.label}
                  value={customValue}
                  onChange={(e) => {
                    setCustomValue(e.target.value);
                    setError(null);
                  }}
                  className={bigInput}
                  aria-invalid={!!error}
                />
                <span className="pb-2.5 font-heading text-[clamp(22px,3.4vw,30px)] font-semibold text-stone">
                  €
                </span>
              </div>
              {error ? (
                <p className="text-[15px] text-warning" role="alert">
                  {error}
                </p>
              ) : null}
              <div>
                <Button type="submit">{t("continue")}</Button>
              </div>
            </form>
          ) : null}
        </div>
      )}

      {question.type !== "number" ? (
        <>
          {showHelp && question.help ? <HelpBox id={`help-${question.id}`}>{question.help}</HelpBox> : null}
          {question.type === "multi" || helpToggle ? (
            <div className="mt-1 flex flex-wrap items-center gap-[14px]">
              {question.type === "multi" ? (
                <Button disabled={multi.length === 0} onClick={() => go(multi)}>
                  {t("continue")}
                </Button>
              ) : null}
              {helpToggle}
            </div>
          ) : null}
        </>
      ) : null}

      {question.why ? <WhyLine label={t("why")}>{question.why}</WhyLine> : null}
    </>
  );
}

function HelpBox({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div id={id} className="max-w-[560px]">
      <InfoBox>{children}</InfoBox>
    </div>
  );
}

/** "Kāpēc jautājam:" line under the options (prototype). */
export function WhyLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="mt-1.5 flex max-w-[560px] gap-[10px] text-[15px] leading-normal text-stone">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-lime"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
      <span>
        <strong className="mr-1.5 font-semibold text-mist">{label}</strong>
        {children}
      </span>
    </p>
  );
}
