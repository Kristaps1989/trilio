"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { requestNotifyAction } from "@/app/[locale]/velmju-saraksts/actions";
import type { SaveTarget } from "@/app/[locale]/velmju-saraksts/save";
import { buttonClass } from "./Button";

// The one step between "Pieprasīt labāku cenu" and the e-mail
// (docs/PRICE_NOTIFY_PLAN.md §2): signed out, one field on the card; signed in
// where Trilio sources, the same sentence with the address already known. The
// sentence says exactly what will be sent; the button is the yes.

type Props = {
  target: SaveTarget;
  /** Signed in: the address is known and only the yes is asked. */
  email: string | null;
  /** Trilio sources this category, so the sentence also covers Trilio's offers. */
  offers: boolean;
  onConsent: () => void;
  onClose: () => void;
};

export function NotifyPanel({ target, email, offers, onConsent, onClose }: Props) {
  const t = useTranslations("notify");
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const search = target.kind === "search";
  const body = search
    ? offers
      ? t("bodySearch")
      : t("bodySearchPlain")
    : offers
      ? t("body")
      : t("bodyPlain");

  if (sent)
    return (
      <p
        role="status"
        className="rounded-control bg-card-soft px-3 py-3 text-[15px] text-night"
        data-notify-sent
      >
        {t(offers ? "sent" : "sentPlain", { email: sent })}
      </p>
    );

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await requestNotifyAction(
        target,
        value,
        `${window.location.pathname}${window.location.search}`,
      );
      if (r.ok) setSent(r.email);
      else
        setError(
          r.reason === "invalid" ? t("invalid") : r.reason === "too_many" ? t("tooMany") : t("failed"),
        );
    });
  }

  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-2 rounded-control bg-card-soft px-3 py-3 text-night"
      data-notify-panel
    >
      <p id={`${id}-title`} className="text-[16px] font-bold">
        {email
          ? t(offers ? "titleSignedIn" : "titleSignedInPlain", { email })
          : t(offers ? "title" : "titlePlain")}
      </p>
      <p className="text-sm" id={`${id}-body`}>
        {body}
      </p>
      {email ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onConsent}
            className={buttonClass({ variant: "dark", size: "sm" })}
            aria-describedby={`${id}-body`}
          >
            {t(offers ? "submit" : "submitPlain")}
          </button>
          <button type="button" onClick={onClose} className={buttonClass({ variant: "card", size: "sm" })}>
            {t("close")}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
          <label htmlFor={`${id}-email`} className="text-sm font-semibold">
            {t("email")}
          </label>
          <input
            id={`${id}-email`}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : `${id}-body`}
            placeholder="tavs@epasts.lv"
            className="min-h-12 w-full rounded-control border-[1.5px] border-google-line bg-white px-3 text-[16px] text-night"
          />
          {error ? (
            <p id={`${id}-error`} role="alert" className="text-sm font-semibold text-danger-ink">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={buttonClass({ variant: "dark", size: "sm" })}>
              {t(offers ? "submit" : "submitPlain")}
            </button>
            <button type="button" onClick={onClose} className={buttonClass({ variant: "card", size: "sm" })}>
              {t("close")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
