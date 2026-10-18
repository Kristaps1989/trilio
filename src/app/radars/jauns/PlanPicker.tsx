"use client";

import { type ReactNode, useState, useTransition } from "react";
import { OptionRow } from "@/ui/OptionRow";
import { PrimaryButton } from "@/ui/PrimaryButton";
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
}: {
  monthly: PlanOption;
  annual: PlanOption;
  returnTo: string;
  payLabel: string;
  note: string;
  /** Auto-renewal, cancellation, withdrawal and terms: shown next to the pay button (EU consumer law). */
  legal: ReactNode;
}) {
  const [plan, setPlan] = useState(annual.id);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div role="radiogroup" className="flex flex-col gap-2">
        <OptionRow
          letter="A"
          label={annual.label}
          sublabel={annual.sublabel}
          selected={plan === annual.id}
          onSelect={() => setPlan(annual.id)}
        />
        <OptionRow
          letter="B"
          label={monthly.label}
          sublabel={monthly.sublabel}
          selected={plan === monthly.id}
          onSelect={() => setPlan(monthly.id)}
        />
      </div>
      <p className="text-sm text-stone">{legal}</p>
      <PrimaryButton
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startCheckoutAction(plan, returnTo);
            if (r && "ok" in r && !r.ok) setError(r.reason);
          })
        }
      >
        {payLabel}
      </PrimaryButton>
      {error ? (
        <p className="text-sm text-warning" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-sm text-stone">{note}</p>
    </div>
  );
}
