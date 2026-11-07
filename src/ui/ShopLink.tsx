"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { askShownAction } from "@/app/[locale]/velmju-saraksts/actions";
import { AskChoices } from "./AskChoices";
import { answered, rememberAnswer, subscribeAnswer } from "./askAnswer";
import type { SaveTarget } from "@/app/[locale]/velmju-saraksts/save";
import { track } from "@/ui/analytics/track";
import { withSource } from "@/domain/analytics/click-source";
import { buttonClass } from "./Button";
import { useRequest } from "./useRequest";

// "Pirkt — {Shop}" with the question before the shop (docs/PRICE_NOTIFY_PLAN.md
// §8.4): the first shop click of a visit opens one sheet with two equal
// choices, request a lower price from Trilio or go to the shop. Neither is
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
  /** The shop price in cents: the sheet turns the "up to" discount into euro for this product. */
  priceCents: number;
  target: SaveTarget;
  saved: boolean;
  /** Trilio sources this category: the question is the request; elsewhere it is the price watch. */
  offers: boolean;
  /** data-ga-* of the shop click; moved to whichever element actually leaves for the shop. */
  analytics: Record<string, string>;
};

export function ShopLink({
  href,
  label,
  shop,
  name,
  price,
  priceCents,
  target,
  saved: initial,
  offers,
  analytics,
}: Props) {
  const t = useTranslations("ask");
  const request = useRequest(target, initial);
  const { saved, closePanel } = request;
  const [open, setOpen] = useState(false);
  // In the server HTML and after an answer this is a plain link; the sheet exists only before the first answer.
  const done = useSyncExternalStore(subscribeAnswer, answered, () => true);
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
    rememberAnswer();
    setOpen(false);
    closePanel();
  }

  // A link opened in a new tab (middle click, Ctrl/⌘-click, long press) skips the question: say so in the link.
  const newTab = (e: { currentTarget: HTMLAnchorElement }) => {
    e.currentTarget.href = withSource(href, "newtab");
  };
  // Already requested: straight to the shop, and /go/ is told so it does not ask either.
  const directSource = saved ? "saved" : "card";

  return (
    <>
      <a
        href={withSource(href, directSource)}
        rel="sponsored noopener"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) newTab(e);
          else e.currentTarget.href = withSource(href, directSource);
          onClick(e);
        }}
        onAuxClick={newTab}
        onContextMenu={newTab}
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
            <AskChoices
              request={request}
              target={target}
              offers={offers}
              priceCents={priceCents}
              shop={shop}
              shopHref={withSource(href, "ask")}
              analytics={analytics}
              onClose={close}
            />
          </div>
        </dialog>
      ) : null}
    </>
  );
}
