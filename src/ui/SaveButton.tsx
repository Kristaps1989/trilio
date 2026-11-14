"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { askWhyAction } from "@/app/[locale]/velmju-saraksts/actions";
import type { SaveTarget } from "@/app/[locale]/velmju-saraksts/save";
import { buttonClass } from "./Button";
import { NotifyPanel } from "./NotifyPanel";
import { maxOfferSavingCents } from "@/domain/offers/discount";
import { formatEur } from "@/i18n/format";
import type { UiLocale } from "@/i18n/routing";
import { AskPromise, AskTrust, HowItWorks, OfferPitch } from "./OfferPitch";
import { SavedAlertNote } from "./SavedAlertNote";
import { useRequest } from "./useRequest";

// "Iegūt lētāk" (docs/PRICE_NOTIFY_PLAN.md §8.3): one tap saves a
// product or a whole search, asks Trilio for a lower price and turns price
// e-mails on; a second tap stops it. Where Trilio does not source (data/
// offers.json "except") the button only promises the price e-mail, with the
// heart. Signed out, the card opens one e-mail field instead of a sign-in
// page. Signed in where Trilio sources, the first tap shows the one sentence
// that also covers Trilio's offers.

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20.5s-7.5-4.6-9.3-9.4C1.5 7.8 3.7 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.3 0 5.5 3.3 4.3 6.6C19.5 15.9 12 20.5 12 20.5z" />
    </svg>
  );
}

// A price tag with an arrow down: the request is for a lower price, not a wish.
function Tag({ filled }: { filled: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3h8l10 10-8 8L3 11z" />
      <circle cx="7.5" cy="7.5" r="1.5" fill={filled ? "#fff" : "currentColor"} stroke="none" />
      <path d="M20 14v6M17 17l3 3 3-3" fill="none" stroke={filled ? "#fff" : "currentColor"} />
    </svg>
  );
}

export function SaveButton({
  target,
  saved: initial,
  variant = "card",
  name,
  offers = false,
  priceCents,
  signer,
  proof,
}: {
  target: SaveTarget;
  saved: boolean;
  /** "card": full-width under a product card; "inline": next to a heading; "icon": heart only. */
  variant?: "card" | "inline" | "icon";
  /** What is saved, for the screen-reader label. */
  name: string;
  /** Trilio sources this category (data/offers.json): the consent sentence covers its offers too. */
  offers?: boolean;
  /** The shop price: the request shows what it can be worth ("līdz −10 %", in euro). */
  priceCents?: number;
  /** Who handles the request, and the anonymous proof line (docs/UX_REVIEW_PLAN.md §5–6). */
  signer?: string | null;
  proof?: string | null;
}) {
  const t = useTranslations("wishlist");
  const ta = useTranslations("ask");
  const locale = useLocale() as UiLocale;
  const { saved, pending, note, panel, run, closePanel } = useRequest(target, initial, variant !== "icon");
  const search = target.kind === "search";
  const savingId = useId();
  const request = offers && !search && variant !== "icon";
  // The form opens under the button: bring it into view, clear of the cookie bar, so the
  // e-mail field is seen without scrolling (panel, 14 Nov 2026: some took the tap for a dud).
  const formRef = useRef<HTMLDivElement>(null);
  const open = !!panel;
  useEffect(() => {
    if (open) formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);
  // Closed unsent: one optional question, asked once per card.
  const [why, setWhy] = useState<"ask" | "done" | null>(null);
  const closeUnsent = () => {
    closePanel();
    if (request && !saved && why === null) setWhy("ask");
  };
  const answerWhy = (reason: string) => {
    setWhy("done");
    void askWhyAction(target, reason);
  };
  const showSaving =
    variant === "card" &&
    offers &&
    !search &&
    !saved &&
    !!priceCents &&
    maxOfferSavingCents(priceCents) >= 100;
  // A search is a watch for a cheaper option; only a product is a request to a partner.
  const key = `${saved ? "notifying" : "notify"}${search ? "Search" : offers ? "" : "Drop"}` as const;
  const text = t(key);

  // On a card the request is the lime button (as in the ads), before and after the tap.
  const className =
    variant === "card"
      ? buttonClass({ variant: "primary", size: "sm", block: true })
      : variant === "inline"
        ? buttonClass({ variant: "outline", size: "sm" })
        : "inline-flex h-11 w-11 items-center justify-center rounded-full text-lime hover:bg-lime-18";

  const button = (
    <button
      type="button"
      aria-label={variant === "icon" ? `${text}: ${name}` : undefined}
      aria-expanded={panel ? true : undefined}
      aria-describedby={showSaving ? savingId : undefined}
      disabled={pending}
      onClick={() => (panel ? closeUnsent() : run(!saved))}
      className={`${className} ${saved && variant !== "card" ? "text-lime" : ""}`}
      data-notify-button
    >
      {offers && !search && variant !== "icon" ? <Tag filled={saved} /> : <Heart filled={saved} />}
      {variant === "icon" ? null : <span>{text}</span>}
      {/* What the request can be worth, where the decision is made (docs/UX_REVIEW_PLAN.md §4). */}
      {showSaving ? (
        <span
          id={savingId}
          aria-hidden="true"
          className="text-sm font-semibold opacity-80"
          data-notify-saving
        >
          {ta("upToShort", {
            amount: formatEur(Math.floor(maxOfferSavingCents(priceCents!) / 100) * 100, locale),
          })}
        </span>
      ) : null}
    </button>
  );
  const whyBlock =
    why && !panel && !saved ? (
      why === "done" ? (
        <p role="status" className="text-[14px] text-muted" data-ask-why="done">
          {ta("why.thanks")}
        </p>
      ) : (
        <div
          role="group"
          aria-labelledby={`${savingId}-why`}
          className="flex flex-col gap-2 text-night"
          data-ask-why="ask"
        >
          <p id={`${savingId}-why`} className="text-[14px] font-semibold">
            {ta("why.title")}
          </p>
          <div className="flex flex-wrap gap-2">
            {(["slow", "trust", "small", "later"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => answerWhy(k)}
                className={buttonClass({ variant: "card", size: "sm" })}
                data-ask-why-option={k}
              >
                {ta(`why.${k}`)}
              </button>
            ))}
          </div>
        </div>
      )
    ) : null;
  if (!panel && !(note && saved))
    return whyBlock ? (
      <div className="flex w-full flex-col gap-2">
        {button}
        {whyBlock}
      </div>
    ) : (
      button
    );
  return (
    <div className="flex w-full flex-col gap-2">
      {button}
      {panel ? (
        // Where Trilio sources, the same screen as the question before the shop (owner, 4 Nov 2026): the discount and the steps first.
        request ? (
          <div
            ref={formRef}
            className="flex scroll-mt-24 scroll-mb-[calc(var(--consent-bar-h,0px)+16px)] flex-col gap-3 text-night"
            data-offer-pitch
          >
            <OfferPitch priceCents={priceCents} steps={false} />
            {/* The field straight after the saving; who sells and the promise follow it. */}
            <NotifyPanel
              target={target}
              email={panel.email}
              offers
              onConsent={() => run(true, true)}
              onClose={closeUnsent}
              compact={!panel.email}
            />
            <AskPromise signer={signer} proof={proof} />
            <AskTrust />
            <HowItWorks />
          </div>
        ) : (
          <NotifyPanel
            target={target}
            email={panel.email}
            offers={offers && !search}
            onConsent={() => run(true, true)}
            onClose={closePanel}
          />
        )
      ) : note && saved ? (
        <SavedAlertNote email={note.email} offers={offers && !search} />
      ) : null}
    </div>
  );
}
