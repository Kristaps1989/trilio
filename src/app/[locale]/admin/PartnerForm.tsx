"use client";

import { useId } from "react";
import { buttonClass } from "@/ui/Button";
import { setPartnerAction } from "./crm-actions";

// "Prasīts partnerim" (docs/CRM_PLAN.md §4): free partner name, the partner's
// order number, the cost when confirmed, a note. On a lead or on one order.

type Labels = {
  title: string;
  status: string;
  requested: string;
  confirmed: string;
  unavailable: string;
  partner: string;
  ref: string;
  cost: string;
  note: string;
  save: string;
};

export function PartnerForm({
  productId,
  orderId,
  back,
  names,
  labels,
  initial,
}: {
  productId: string;
  orderId?: string | null;
  back: string;
  names: string[];
  labels: Labels;
  initial?: { partner: string | null; ref: string | null } | null;
}) {
  const id = useId();
  const field =
    "min-h-11 w-full rounded-control border-[1.5px] border-mist/35 bg-white-5 px-3 text-[16px] text-mist placeholder:text-stone";
  return (
    <details className="rounded-panel-lg border-[1.5px] border-line-25 px-4 py-2" data-partner-form>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-mist">
        {labels.title}
      </summary>
      <form action={setPartnerAction} className="flex flex-col gap-3 pt-2 pb-3">
        <input type="hidden" name="productId" value={productId} />
        {orderId ? <input type="hidden" name="orderId" value={orderId} /> : null}
        <input type="hidden" name="back" value={back} />
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1 text-sm font-semibold text-mist">{labels.status}</legend>
          {(["requested", "confirmed", "unavailable"] as const).map((s, i) => (
            <label
              key={s}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-line-30 px-4 text-[15px] font-semibold text-mist has-[:checked]:border-mist has-[:checked]:bg-mist has-[:checked]:text-night"
            >
              <input type="radio" name="status" value={s} defaultChecked={i === 0} className="sr-only" />
              {labels[s]}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-sm font-semibold text-mist">
          {labels.partner}
          <input
            name="partner"
            list={`${id}-names`}
            defaultValue={initial?.partner ?? ""}
            maxLength={100}
            className={field}
          />
          <datalist id={`${id}-names`}>
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-mist">
          {labels.ref}
          <input name="ref" defaultValue={initial?.ref ?? ""} maxLength={100} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-mist">
          {labels.cost}
          <input name="cost" inputMode="decimal" placeholder="0,00" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-mist">
          {labels.note}
          <textarea name="note" rows={2} maxLength={1000} className={`${field} py-2`} />
        </label>
        <div>
          <button type="submit" className={buttonClass({ variant: "primary", size: "sm" })}>
            {labels.save}
          </button>
        </div>
      </form>
    </details>
  );
}
