"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setPriceAlertsAction } from "@/app/[locale]/velmju-saraksts/actions";

// Under a heart just tapped (docs/TRUST_POLISH_PLAN.md §1): saving is the
// request to hear when the price drops, said plainly, with the way out in
// the same line and the way back after it.

export function SavedAlertNote({ email }: { email: string }) {
  const t = useTranslations("wishlist");
  const [on, setOn] = useState(true);
  const [pending, start] = useTransition();

  function change(next: boolean) {
    setOn(next);
    start(async () => {
      if (!(await setPriceAlertsAction(next))) setOn(!next);
    });
  }

  return (
    <p role="status" className="text-sm text-night" data-alert-note={on ? "on" : "off"}>
      {on ? t("alertNote", { email }) : t("alertNoteOff")}{" "}
      <button
        type="button"
        disabled={pending}
        onClick={() => change(!on)}
        className="-my-3 inline-flex min-h-11 items-center align-middle font-semibold underline underline-offset-2"
        data-ga-event={on ? "price_alert_off" : "price_alert_on"}
      >
        {on ? t("alertStop") : t("alertResume")}
      </button>
    </p>
  );
}
