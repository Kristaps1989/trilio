"use client";

import { useTranslations } from "next-intl";
import type { SaveTarget } from "@/app/[locale]/velmju-saraksts/save";
import { rememberAnswer } from "./askAnswer";
import { buttonClass } from "./Button";
import { NotifyPanel } from "./NotifyPanel";
import { AskPromise, AskTrust, HowItWorks, OfferPitch } from "./OfferPitch";
import { SavedAlertNote } from "./SavedAlertNote";
import type { useRequest } from "./useRequest";

// The question before the shop on one screen (docs/UX_REVIEW_PLAN.md §5): the
// saving in euro, what happens and who does it, then the e-mail field at once
// (signed out) or one button (signed in), the steps and the caveat folded under
// "Kā tas strādā?", and the shop as the second, plainer choice. Shared by the
// card's sheet (ShopLink) and the page /pirms-veikala/<offer>.

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
  /** Signed in: one button; signed out: the e-mail field straight away. */
  signedIn?: boolean;
  /** Who handles the request ("Kristaps"), and the anonymous proof line. */
  signer?: string | null;
  proof?: string | null;
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
  signedIn = false,
  signer,
  proof,
}: Props) {
  const t = useTranslations("ask");
  const { saved, pending, note, panel, run } = request;
  // The second choice, plainer than the request but a full, visible button (CLAUDE.md rule 4).
  const toShop = (
    <a
      href={shopHref}
      rel="sponsored noopener"
      onClick={rememberAnswer}
      {...analytics}
      className={buttonClass({ variant: "card", block: true })}
      data-ask-shop
    >
      {t("toShop", { shop })}
    </a>
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

  // Signed in where Trilio sources, the one yes with the known address; signed out, the field at once.
  const form =
    panel || !signedIn ? (
      <NotifyPanel
        target={target}
        email={panel?.email ?? null}
        offers={offers}
        onConsent={() => run(true, true)}
        onClose={onClose}
        onGoogle={rememberAnswer}
        compact
        hideClose
      />
    ) : (
      <button
        type="button"
        disabled={pending}
        onClick={() => run(true)}
        className={buttonClass({ variant: "primary", block: true })}
        data-ga-event="ask_request"
      >
        {t(offers ? "sendRequest" : "requestPlain")}
      </button>
    );

  return (
    <>
      {offers ? (
        <>
          <OfferPitch priceCents={priceCents} steps={false} />
        </>
      ) : (
        <p className="text-[15px] leading-snug">{t("bodyPlain")}</p>
      )}
      {/* The field straight after the saving: what to do comes before the explanation. */}
      {form}
      {offers ? (
        <>
          <AskPromise signer={signer} proof={proof} />
          <AskTrust />
          <HowItWorks />
        </>
      ) : null}
      {toShop}
    </>
  );
}
