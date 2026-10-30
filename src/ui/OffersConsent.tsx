"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setOffersOptInAction } from "@/app/[locale]/velmju-saraksts/actions";

// Consent to personal offers by e-mail (docs/ADMIN_AND_OFFERS_PLAN.md §2.3,
// §11.7) in the wishlist and account pages: a checkbox the shopper ticks,
// never pre-ticked, and unticked the same way. On a card the same yes is the
// "Paziņot man" under the notify sentence (NotifyPanel).

export function OffersConsent({ initial }: { initial: boolean }) {
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
    <div className="flex flex-col gap-2">
      <label className="flex min-h-11 items-start gap-3 text-[15px] text-mist">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => change(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-lime"
        />
        <span>{t("label")}</span>
      </label>
      {touched && !pending ? (
        <p role="status" className="text-sm text-stone">
          {on ? t("on") : t("off")}
        </p>
      ) : (
        <p className="text-sm text-stone">{t("hint")}</p>
      )}
    </div>
  );
}
