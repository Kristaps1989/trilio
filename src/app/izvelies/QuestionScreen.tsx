"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { encodeState, withAnswer, type FlowState } from "@/domain/flow/state";
import { formatEur } from "@/i18n/format";
import { Button } from "@/ui/Button";
import { Illustration } from "@/ui/illustrations/Illustration";
import { InfoBox, PageTitle } from "@/ui/layout";
import { OptionRow } from "@/ui/OptionRow";
import { DualRange, Histogram, SingleRange } from "@/ui/RangeSlider";
import { useLiveCount } from "@/ui/useLiveCount";

// One question per screen (spec §2, core rules in docs/FILTERS_PLAN.md):
// picture cards with live counts and the most common answer pre-selected,
// one-handle limits that open on "no limit", and the price range over a
// histogram of real prices. Every screen says how many products the current
// choice leaves; the URL carries the answers, so back and refresh work.

export type ScreenOption = {
  value: string;
  label: string;
  sublabel?: string | null;
  illustration?: string;
  /** Products this answer leaves; 0 shows "Pašlaik nav pieejams". */
  count?: number;
};

type Common = { id: string; title: string; why?: string | null; help?: string | null };

export type ScreenQuestion =
  | (Common & { kind: "choice"; options: ScreenOption[]; defaultValue: string | null })
  | (Common & { kind: "range"; unit: string; min: number; max: number; step: number; presets: number[] })
  | (Common & {
      kind: "number";
      input: { min: number; max: number; default: number; unit: string; step: number };
    })
  | (Common & {
      kind: "price";
      stats: {
        minCents: number;
        maxCents: number;
        buckets: number[];
        defaultMinCents: number;
        defaultMaxCents: number;
      } | null;
      presetsCents: number[];
    });

const AUTO_ADVANCE_MS = 260;
const LETTERS = "ABCDEFGHIJKLMNOP";

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function QuestionScreen({
  question,
  state,
  basePath,
  subId,
}: {
  question: ScreenQuestion;
  state: FlowState;
  basePath: string;
  subId: string;
}) {
  const t = useTranslations("flow");
  const router = useRouter();
  const [showHelp, setShowHelp] = useState(false);

  function go(value: unknown) {
    const next = withAnswer(state, question.id, value);
    router.push(`${basePath}?a=${encodeState(next)}`);
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

  return (
    <>
      <PageTitle>{question.title}</PageTitle>
      {question.kind === "choice" ? <ChoiceBody q={question} state={state} go={go} /> : null}
      {question.kind === "range" ? <RangeBody q={question} state={state} go={go} subId={subId} /> : null}
      {question.kind === "number" ? <NumberBody q={question} state={state} go={go} subId={subId} /> : null}
      {question.kind === "price" ? <PriceBody q={question} state={state} go={go} subId={subId} /> : null}
      {showHelp && question.help ? (
        <div id={`help-${question.id}`} className="max-w-[560px]">
          <InfoBox>{question.help}</InfoBox>
        </div>
      ) : null}
      {helpToggle ? <div className="flex flex-wrap items-center gap-[14px]">{helpToggle}</div> : null}
      {question.why ? <WhyLine label={t("why")}>{question.why}</WhyLine> : null}
    </>
  );
}

function ChoiceBody({
  q,
  state,
  go,
}: {
  q: Extract<ScreenQuestion, { kind: "choice" }>;
  state: FlowState;
  go: (v: unknown) => void;
}) {
  const t = useTranslations("flow");
  const current = state.answers[q.id];
  const initial = typeof current === "string" ? current : q.defaultValue;
  const [selected, setSelected] = useState<string | null>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const pictures = q.options.some((o) => o.illustration);

  function pick(value: string) {
    setSelected(value);
    timer.current = setTimeout(() => go(value), reducedMotion() ? 0 : AUTO_ADVANCE_MS);
  }

  const unavailable = (o: ScreenOption) => o.count === 0 && current !== o.value;

  return (
    <>
      <div
        role="radiogroup"
        aria-label={q.title}
        className={
          pictures
            ? "mt-1.5 grid grid-cols-2 gap-[10px] sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
            : "mt-1.5 flex max-w-[540px] flex-col gap-[10px]"
        }
      >
        {q.options.map((o, i) =>
          pictures ? (
            <PictureCard
              key={o.value}
              option={o}
              selected={selected === o.value}
              disabled={unavailable(o)}
              onSelect={() => pick(o.value)}
              countText={o.count === undefined ? null : t("count", { count: o.count })}
              questionId={q.id}
            />
          ) : (
            <OptionRow
              key={o.value}
              letter={LETTERS[i] ?? "•"}
              label={o.label}
              sublabel={[o.sublabel, o.count === undefined ? null : t("count", { count: o.count })]
                .filter(Boolean)
                .join(" · ")}
              selected={selected === o.value}
              onSelect={() => pick(o.value)}
              analytics={{ event: "answer_question", params: { question: q.id, option: o.value } }}
            />
          ),
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-[14px]">
        <Button disabled={!selected} onClick={() => selected && go(selected)}>
          {t("next")}
        </Button>
      </div>
    </>
  );
}

function PictureCard({
  option,
  selected,
  disabled,
  onSelect,
  countText,
  questionId,
}: {
  option: ScreenOption;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  countText: string | null;
  questionId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onSelect}
      data-ga-event="answer_question"
      data-ga-param-question={questionId}
      data-ga-param-option={option.value}
      className={`flex min-h-[44px] flex-col items-center gap-1.5 rounded-panel border-[1.5px] px-3 pt-3 pb-3.5 text-center transition-colors ${
        selected
          ? "border-lime bg-lime-18"
          : disabled
            ? "border-mist-32 bg-white-5 opacity-50"
            : "border-mist-32 bg-white-5 hover:border-line-40"
      }`}
    >
      {option.illustration ? (
        <Illustration name={option.illustration} className="h-24 w-24 text-lime sm:h-28 sm:w-28" />
      ) : null}
      <span className="text-[17px] font-semibold leading-tight text-mist">{option.label}</span>
      {option.sublabel ? <span className="text-sm leading-snug text-stone">{option.sublabel}</span> : null}
      {countText ? <span className="text-[13px] font-semibold text-lime">{countText}</span> : null}
    </button>
  );
}

function LiveLine({ count }: { count: number | null }) {
  const t = useTranslations("flow");
  return (
    <p className="min-h-6 text-[15px] font-semibold text-lime" aria-live="polite">
      {count === null ? "" : t("matching", { count })}
    </p>
  );
}

function RangeBody({
  q,
  state,
  go,
  subId,
}: {
  q: Extract<ScreenQuestion, { kind: "range" }>;
  state: FlowState;
  go: (v: unknown) => void;
  subId: string;
}) {
  const t = useTranslations("flow");
  const current = state.answers[q.id];
  const currentMax =
    typeof current === "object" && current !== null && !Array.isArray(current) ? current.max : undefined;
  const [limited, setLimited] = useState(currentMax !== undefined);
  const [max, setMax] = useState<number>(currentMax ?? q.presets[0] ?? q.max);
  const answer = limited ? { max } : {};
  const encoded = useMemo(() => encodeState(withAnswer(state, q.id, answer)), [state, q.id, limited, max]); // eslint-disable-line react-hooks/exhaustive-deps
  const { count } = useLiveCount(subId, encoded);
  const fmt = (v: number) => `${String(v).replace(".", ",")} ${q.unit}`;

  return (
    <>
      <div role="radiogroup" aria-label={q.title} className="mt-1.5 flex max-w-[540px] flex-col gap-[10px]">
        <OptionRow
          letter="A"
          label={t("noLimit")}
          sublabel={t("noLimitSub")}
          selected={!limited}
          onSelect={() => setLimited(false)}
        />
        <OptionRow
          letter="B"
          label={t("hasLimit")}
          sublabel={t("hasLimitSub")}
          selected={limited}
          onSelect={() => setLimited(true)}
        />
      </div>
      {limited ? (
        <div className="flex max-w-[540px] flex-col gap-3">
          <p className="font-heading text-[clamp(26px,5vw,36px)] font-semibold text-mist" aria-hidden="true">
            {t("upTo", { value: String(max).replace(".", ","), unit: q.unit })}
          </p>
          <SingleRange
            label={t("rangeLabel", { title: q.title })}
            min={q.min}
            max={q.max}
            step={q.step}
            value={max}
            onChange={setMax}
            valueText={fmt(max)}
          />
          {q.presets.length ? (
            <div className="flex flex-wrap gap-2">
              {q.presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setMax(p)}
                  aria-pressed={max === p}
                  className={`min-h-11 rounded-full px-4 text-sm font-semibold ${
                    max === p ? "bg-lime text-night" : "bg-chip text-mist hover:bg-lime-18"
                  }`}
                >
                  {t("upTo", { value: String(p).replace(".", ","), unit: q.unit })}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <LiveLine count={count} />
      <div className="flex flex-wrap items-center gap-[14px]">
        <Button onClick={() => go(answer)}>{t("next")}</Button>
      </div>
    </>
  );
}

function NumberBody({
  q,
  state,
  go,
  subId,
}: {
  q: Extract<ScreenQuestion, { kind: "number" }>;
  state: FlowState;
  go: (v: unknown) => void;
  subId: string;
}) {
  const t = useTranslations("flow");
  const current = state.answers[q.id];
  const [value, setValue] = useState(typeof current === "number" ? String(current) : String(q.input.default));
  const [error, setError] = useState<string | null>(null);
  const n = Number(value.replace(",", "."));
  const valid = Number.isFinite(n) && n >= q.input.min && n <= q.input.max;
  const encoded = useMemo(
    () => encodeState(valid ? withAnswer(state, q.id, n) : state),
    [state, q.id, valid, n],
  );
  const { count } = useLiveCount(subId, encoded);
  const bigInput =
    "min-w-0 flex-1 border-0 border-b-2 border-lime bg-transparent py-2 font-heading text-[clamp(24px,4vw,36px)] font-semibold text-mist outline-none placeholder:text-stone/60";

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return setError(t("numberHint", { min: q.input.min, max: q.input.max }));
        go(n);
      }}
    >
      <div className="mt-1.5 flex max-w-[560px] items-end gap-3">
        <label htmlFor={`answer-${q.id}`} className="sr-only">
          {q.title}
        </label>
        <input
          id={`answer-${q.id}`}
          name="value"
          inputMode="decimal"
          enterKeyHint="go"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          className={bigInput}
          aria-invalid={!!error}
          aria-describedby={`number-hint-${q.id}${error ? " number-error" : ""}`}
        />
        <span className="pb-2.5 font-heading text-[clamp(22px,3.4vw,30px)] font-semibold text-stone">
          {q.input.unit}
        </span>
      </div>
      <p id={`number-hint-${q.id}`} className="text-[15px] text-stone">
        {t("numberHint", { min: q.input.min, max: q.input.max })}
      </p>
      {error ? (
        <p id="number-error" className="text-[15px] text-warning" role="alert">
          {error}
        </p>
      ) : null}
      <LiveLine count={valid ? count : null} />
      <div className="flex flex-wrap items-center gap-[14px]">
        <Button type="submit">{t("next")}</Button>
      </div>
    </form>
  );
}

function PriceBody({
  q,
  state,
  go,
  subId,
}: {
  q: Extract<ScreenQuestion, { kind: "price" }>;
  state: FlowState;
  go: (v: unknown) => void;
  subId: string;
}) {
  const t = useTranslations("budget");
  const stats = q.stats;
  const step = 1000;
  const lo = stats ? Math.floor(stats.minCents / step) * step : 0;
  const hi = stats ? Math.max(lo + step, Math.ceil(stats.maxCents / step) * step) : 100_000;
  const b = state.trailing.budget;
  const initial =
    typeof b === "object" && b !== null
      ? { min: b.min ?? lo, max: b.max ?? hi }
      : typeof b === "number"
        ? { min: lo, max: b }
        : stats
          ? { min: stats.defaultMinCents, max: stats.defaultMaxCents }
          : { min: lo, max: hi };
  const [range, setRange] = useState({ min: Math.max(lo, initial.min), max: Math.min(hi, initial.max) });
  const answer = { min: range.min > lo ? range.min : undefined, max: range.max < hi ? range.max : undefined };
  const encoded = encodeState(withAnswer(state, "budget", answer));
  const { count, suggestion } = useLiveCount(subId, encoded);

  function setField(key: "min" | "max", text: string) {
    const eur = Number(text.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(eur)) return;
    const cents = Math.round(eur) * 100;
    setRange((r) =>
      key === "min"
        ? { min: Math.min(Math.max(lo, cents), r.max), max: r.max }
        : { min: r.min, max: Math.max(Math.min(hi, cents), r.min) },
    );
  }

  return (
    <>
      <div className="flex max-w-[620px] flex-col gap-3">
        <p className="font-heading text-[clamp(28px,5vw,40px)] font-semibold text-mist" aria-hidden="true">
          {t("range", { min: formatEur(range.min), max: formatEur(range.max) })}
        </p>
        {stats ? (
          <Histogram
            buckets={stats.buckets}
            min={stats.minCents}
            max={stats.maxCents}
            value={range}
            description={t("histogram", { min: formatEur(stats.minCents), max: formatEur(stats.maxCents) })}
          />
        ) : null}
        <DualRange
          labels={{ min: t("minLabel"), max: t("maxLabel") }}
          min={lo}
          max={hi}
          step={step}
          value={range}
          onChange={setRange}
          valueText={(v) => formatEur(v)}
        />
        <div className="flex gap-3">
          {(["min", "max"] as const).map((key) => (
            <label key={key} className="flex flex-1 flex-col gap-1 text-sm text-stone">
              {key === "min" ? t("from") : t("to")}
              <span className="flex items-center gap-2 rounded-control border-[1.5px] border-mist-32 px-3">
                <input
                  inputMode="numeric"
                  aria-label={key === "min" ? t("minLabel") : t("maxLabel")}
                  value={String(Math.round(range[key] / 100))}
                  onChange={(e) => setField(key, e.target.value)}
                  className="min-h-11 w-full bg-transparent text-lg font-semibold text-mist outline-none"
                />
                <span aria-hidden="true">€</span>
              </span>
            </label>
          ))}
        </div>
        {q.presetsCents.length ? (
          <div className="flex flex-wrap gap-2">
            {q.presetsCents.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setRange({ min: lo, max: Math.min(hi, p) })}
                className="min-h-11 rounded-full bg-chip px-4 text-sm font-semibold text-mist hover:bg-lime-18"
              >
                {t("upTo", { amount: formatEur(p) })}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {count === 0 && suggestion?.kind === "price_max" && suggestion.maxCents ? (
        <InfoBox className="max-w-[620px]">
          <span className="flex flex-wrap items-center justify-between gap-3">
            {t("widen", { amount: formatEur(suggestion.maxCents) })}
            <Button
              size="sm"
              variant="lime"
              onClick={() => setRange((r) => ({ min: r.min, max: suggestion.maxCents! }))}
            >
              {formatEur(suggestion.maxCents)}
            </Button>
          </span>
        </InfoBox>
      ) : null}
      <div className="flex flex-wrap items-center gap-[14px]">
        <Button
          disabled={count === 0}
          onClick={() => go(answer.min === undefined && answer.max === undefined ? "none" : answer)}
        >
          {count === null ? t("showPending") : t("show", { count })}
        </Button>
        <Button variant="link" size="md" onClick={() => go("none")}>
          {t("notSet")}
        </Button>
      </div>
    </>
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
