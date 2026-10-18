"use client";

import { type ReactNode, useState, useTransition } from "react";
import { Button } from "@/ui/Button";
import { startCheckoutAction } from "../actions";

// Spec §5.1 step 5–6: plan, then the provider's hosted checkout. Card data
// never touches our pages (the note says so).

type PlanOption = { id: string; label: string; sublabel?: string };

export function PlanPicker({
  monthly,
  annual,
  returnTo,
  payLabel,
  note,
  legal,
  features,
}: {
  monthly: PlanOption;
  annual: PlanOption;
  returnTo: string;
  payLabel: string;
  note: string;
  /** Auto-renewal, cancellation, withdrawal and terms: shown next to the pay button (EU consumer law). */
  legal: ReactNode;
  features: string[];
}) {
  const [plan, setPlan] = useState(annual.id);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label={payLabel} className="grid gap-[10px] sm:grid-cols-2">
        {[annual, monthly].map((p) => {
          const selected = plan === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPlan(p.id)}
              className={`flex min-h-[88px] flex-col items-start justify-center gap-1 rounded-panel border-[1.5px] px-5 py-4 text-left transition-colors ${
                selected ? "border-lime bg-lime-18" : "border-mist-32 bg-white-5 hover:border-line-40"
              }`}
            >
              <span className="font-heading text-[26px] leading-none font-bold text-mist">{p.label}</span>
              {p.sublabel ? <span className="text-sm font-semibold text-lime">{p.sublabel}</span> : null}
            </button>
          );
        })}
      </div>
      <ul className="flex flex-col gap-2 rounded-panel border-[1.5px] border-lime p-5 text-base">
        {features.map((f) => (
          <li key={f} className="flex gap-[10px]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="mt-1 shrink-0 text-lime"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <p className="text-[13px] leading-normal text-stone">{legal}</p>
      <Button
        size="lg"
        block
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startCheckoutAction(plan, returnTo);
            if (r && "ok" in r && !r.ok) setError(r.reason);
          })
        }
      >
        {payLabel}
      </Button>
      {error ? (
        <p className="text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
      <p className="flex gap-[10px] text-[13px] leading-normal text-stone">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="mt-0.5 shrink-0"
        >
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <span>{note}</span>
      </p>
    </div>
  );
}
