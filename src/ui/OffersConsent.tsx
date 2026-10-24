"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setOffersOptInAction } from "@/app/[locale]/velmju-saraksts/actions";

// Consent to personal offers by e-mail (docs/ADMIN_AND_OFFERS_PLAN.md §2.3,
// §11.7): a checkbox the shopper ticks, never pre-ticked, and unticked the
// same way. `compact` is the one line under a heart just tapped.

export function OffersConsent({ initial, compact = false }: { initial: boolean; compact?: boolean }) {
  const t = useTranslations("offersConsent");
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const [touched, setTouched] = useState(false);

  function change(next: boolean) {
    setOn(next);
    setTouched(true);
    start(async () => {
      if (!(await setOffersOptInAction(next))) setOn(!next);
    });
  }

  return (
    <div className={compact ? "rounded-control bg-card-soft px-3 py-2 text-night" : "flex flex-col gap-2"}>
      <label className={`flex min-h-11 items-start gap-3 ${compact ? "text-sm" : "text-[15px] text-mist"}`}>
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => change(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-lime"
        />
        <span>{compact ? t("ask") : t("label")}</span>
      </label>
      {touched && !pending ? (
        <p role="status" className={`text-sm ${compact ? "text-muted" : "text-stone"}`}>
          {on ? t("on") : t("off")}
        </p>
      ) : !compact ? (
        <p className="text-sm text-stone">{t("hint")}</p>
      ) : null}
    </div>
  );
}
