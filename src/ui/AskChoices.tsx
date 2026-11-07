"use client";

import { useTranslations } from "next-intl";
import type { SaveTarget } from "@/app/[locale]/velmju-saraksts/save";
import { rememberAnswer } from "./askAnswer";
import { buttonClass } from "./Button";
import { NotifyPanel } from "./NotifyPanel";
import { OfferFine, OfferPitch } from "./OfferPitch";
import { SavedAlertNote } from "./SavedAlertNote";
import type { useRequest } from "./useRequest";

// The two equal choices of the question before the shop (docs/PRICE_NOTIFY_PLAN.md
// §8.4): request a lower price from Trilio, or go to the shop. Shared by the
// sheet on a card (ShopLink) and the question page /pirms-veikala/<offer>
// that /go/ opens when the page's script has not run (docs/CLICK_QUALITY_PLAN.md §2).

type Props = {
  request: ReturnType<typeof useRequest>;
  target: SaveTarget;
  /** Trilio sources this category: the question is the request; elsewhere it is the price watch. */
  offers: boolean;
  priceCents: number;
  shop: string;
  /** The shop link of the answer: /go/<offer>?…&from=ask. */
  shopHref: string;
  /** data-ga-* of the shop click. */
  analytics?: Record<string, string>;
  onClose: () => void;
};

export function AskChoices({
  request,
  target,
  offers,
  priceCents,
  shop,
  shopHref,
  analytics,
  onClose,
}: Props) {
  const t = useTranslations("ask");
  const { saved, pending, note, panel, run } = request;
  const toShop = (
    <a
      href={shopHref}
      rel="sponsored noopener"
      onClick={rememberAnswer}
      {...analytics}
      className={buttonClass({ variant: "dark", block: true })}
      data-ask-shop
    >
      {t("toShop", { shop })}
    </a>
  );
  // Where Trilio sources (owner, 3 Nov 2026, variant C2): the discount first, in euro for this product, then the three steps.
  const pitch = offers ? <OfferPitch priceCents={priceCents} /> : null;
  const fine = offers ? <OfferFine /> : null;

  if (panel)
    return (
      <>
        {panel.email ? null : pitch}
        <NotifyPanel
          target={target}
          email={panel.email}
          offers={offers}
          onConsent={() => run(true, true)}
          onClose={onClose}
          onGoogle={rememberAnswer}
          compact={offers && !panel.email}
        />
        {panel.email ? null : fine}
        {toShop}
      </>
    );
  if (saved)
    return (
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
    );
  return (
    <>
      {offers ? pitch : <p className="text-[15px] leading-snug">{t("bodyPlain")}</p>}
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
      {fine}
    </>
  );
}
