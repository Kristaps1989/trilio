"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { askShownAction } from "@/app/[locale]/velmju-saraksts/actions";
import type { SaveTarget } from "@/app/[locale]/velmju-saraksts/save";
import { track } from "@/ui/analytics/track";
import { buttonClass } from "./Button";
import { NotifyPanel } from "./NotifyPanel";
import { SavedAlertNote } from "./SavedAlertNote";
import { useRequest } from "./useRequest";

// "Pirkt — {Shop}" with the question before the shop (docs/PRICE_NOTIFY_PLAN.md
// §8.4): the first shop click of a visit opens one sheet with two equal
// choices, request a better price from Trilio or go to the shop. Neither is
// hidden or shamed; Esc and the backdrop close it, and after any answer every
// shop link goes straight through for a day, in every tab (owner, 1 Nov 2026:
// once per visitor, not once per click). A product already requested never asks. The link stays a real <a href="/go/…">, so
// crawlers, middle clicks and modifier clicks behave as before.

const ASK_KEY = "trilio_ask_shop";
/** How long one answer holds. */
const ASK_TTL_MS = 24 * 60 * 60 * 1000;

type Props = {
  href: string;
  label: string;
  shop: string;
  name: string;
  price: string;
  target: SaveTarget;
  saved: boolean;
  /** Trilio sources this category: the question is the request; elsewhere it is the price watch. */
  offers: boolean;
  /** data-ga-* of the shop click; moved to whichever element actually leaves for the shop. */
  analytics: Record<string, string>;
};

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

function answered(): boolean {
  try {
    const at = Number(localStorage.getItem(ASK_KEY));
    return at > 0 && Date.now() - at < ASK_TTL_MS;
  } catch {
    return true;
  }
}

function remember() {
  try {
    localStorage.setItem(ASK_KEY, String(Date.now()));
  } catch {
    /* storage blocked: the question is simply asked again */
  }
  for (const l of listeners) l();
}

export function ShopLink({
  href,
  label,
  shop,
  name,
  price,
  target,
  saved: initial,
  offers,
  analytics,
}: Props) {
  const t = useTranslations("ask");
  const { saved, pending, note, panel, run, closePanel } = useRequest(target, initial);
  const [open, setOpen] = useState(false);
  // In the server HTML and after an answer this is a plain link; the sheet exists only before the first answer.
  const done = useSyncExternalStore(subscribe, answered, () => true);
  const direct = saved || done;
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = `ask-${target.kind === "product" ? target.productId : "s"}`;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (direct || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    setOpen(true);
    track("ask_shown");
    void askShownAction(target);
  }

  function close() {
    remember();
    setOpen(false);
    closePanel();
  }

  const shopHref = `${href}${href.includes("?") ? "&" : "?"}ask=1`;
  const toShop = (
    <a
      href={shopHref}
      rel="sponsored noopener"
      onClick={remember}
      {...analytics}
      className={buttonClass({ variant: "dark", block: true })}
      data-ask-shop
    >
      {t("toShop", { shop })}
    </a>
  );

  return (
    <>
      <a
        href={href}
        rel="sponsored noopener"
        onClick={onClick}
        {...(direct ? analytics : { "data-ga-ignore": "" })}
        aria-haspopup={direct ? undefined : "dialog"}
        className={buttonClass({ variant: "dark", block: true })}
      >
        {label}
      </a>
      {open ? (
        <dialog
          ref={ref}
          aria-labelledby={titleId}
          onClose={close}
          onClick={(e) => e.target === ref.current && close()}
          className="m-0 mt-auto w-full max-w-none rounded-t-[22px] bg-white p-0 text-night backdrop:bg-black/60 sm:m-auto sm:max-w-[480px] sm:rounded-[22px]"
          data-ask-sheet
        >
          <div className="flex max-h-[85dvh] flex-col gap-3 overflow-y-auto px-5 pt-5 pb-6">
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="font-heading text-[22px] leading-tight font-semibold">
                {t(offers ? "title" : "titlePlain")}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label={t("close")}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-card-button-line"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <p className="text-[15px] font-semibold">{t("product", { name, price, shop })}</p>
            {panel ? (
              <>
                <NotifyPanel
                  target={target}
                  email={panel.email}
                  offers={offers}
                  onConsent={() => run(true, true)}
                  onClose={close}
                />
                {toShop}
              </>
            ) : saved ? (
              <>
                {note ? (
                  <SavedAlertNote email={note.email} offers={offers} />
                ) : (
                  <p role="status" className="text-[15px]">
                    {t(offers ? "done" : "donePlain")}
                  </p>
                )}
                {toShop}
              </>
            ) : (
              <>
                <p className="text-[15px] leading-snug">{t(offers ? "body" : "bodyPlain")}</p>
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(true)}
                    className={buttonClass({ variant: "primary", block: true })}
                    data-ga-event="ask_request"
                  >
                    {t(offers ? "request" : "requestPlain")}
                  </button>
                  {toShop}
                </div>
              </>
            )}
          </div>
        </dialog>
      ) : null}
    </>
  );
}
