"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setPriceAlertsAction } from "@/app/[locale]/velmju-saraksts/actions";

// Price-drop e-mails about saved items, in the wishlist and account pages:
// free and on by default (docs/TRUST_POLISH_PLAN.md §1), off with one untick.

export function PriceAlertsSwitch({ initial, email }: { initial: boolean; email: string }) {
  const t = useTranslations("wishlist");
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const [touched, setTouched] = useState(false);

  function change(next: boolean) {
    setOn(next);
    setTouched(true);
    start(async () => {
      if (!(await setPriceAlertsAction(next))) setOn(!next);
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
        <span>{t("alertsLabel")}</span>
      </label>
      <p role={touched && !pending ? "status" : undefined} className="text-sm text-stone">
        {on ? t("alertsOn", { email }) : t("alertsOff")}
      </p>
    </div>
  );
}
