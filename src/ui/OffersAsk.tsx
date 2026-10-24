"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setOffersOptInAction } from "@/app/[locale]/velmju-saraksts/actions";
import { buttonClass } from "./Button";

// Trilio's own offers are a commercial communication: they need a "yes" the
// shopper gives (Information Society Services Law art. 9, GDPR). Asked once,
// after the first save, with two equal buttons; the answer is kept and the
// question never comes back (docs/TRUST_POLISH_PLAN.md §1).

export function OffersAsk() {
  const t = useTranslations("offersConsent");
  const id = useId();
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [pending, start] = useTransition();

  function yes() {
    setAnswer("yes");
    start(async () => {
      if (!(await setOffersOptInAction(true))) setAnswer(null);
    });
  }

  if (answer)
    return (
      <p role="status" className="rounded-control bg-card-soft px-3 py-2 text-sm text-night">
        {answer === "yes" ? t("on") : t("askNo")}
      </p>
    );

  return (
    <div
      role="group"
      aria-labelledby={`${id}-q`}
      className="flex flex-col gap-2 rounded-control bg-card-soft px-3 py-3 text-night"
      data-offers-ask
    >
      <p id={`${id}-q`} className="text-[15px] font-bold">
        {t("askTitle")}
      </p>
      <p className="text-sm">{t("askBody")}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={yes}
          className={buttonClass({ variant: "card", size: "sm" })}
          data-ga-event="offers_ask_yes"
        >
          {t("askYes")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setAnswer("no")}
          className={buttonClass({ variant: "card", size: "sm" })}
          data-ga-event="offers_ask_no"
        >
          {t("askNoButton")}
        </button>
      </div>
    </div>
  );
}
