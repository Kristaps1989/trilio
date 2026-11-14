"use client";

import { useLocale, useTranslations } from "next-intl";
import { OFFER_DISCOUNT_UP_TO_PCT, maxOfferSavingCents } from "@/domain/offers/discount";
import { formatEur } from "@/i18n/format";
import type { UiLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";

// What leaving an e-mail is worth, where Trilio sources (docs/PRICE_NOTIFY_PLAN.md
// §8.7): the lime "līdz −10 %" strip with the saving in euro for this product,
// then the three steps. One component for the question before the shop and for
// the card's own "Iegūt lētāk" (owner, 4 Nov 2026), so both say the same.

export function OfferPitch({ priceCents, steps = true }: { priceCents?: number; steps?: boolean }) {
  const t = useTranslations("ask");
  const locale = useLocale() as UiLocale;
  const saving = priceCents ? maxOfferSavingCents(priceCents) : 0;
  return (
    <>
      {saving > 0 ? (
        <div
          className="flex items-center gap-3 rounded-control bg-lime px-4 py-2.5 text-night"
          data-ask-discount
        >
          <span className="font-heading text-[30px] leading-none font-bold whitespace-nowrap">
            {t("upTo", { pct: OFFER_DISCOUNT_UP_TO_PCT })}
          </span>
          <span className="text-[14px] leading-snug">
            {t.rich("saving", {
              amount: formatEur(saving, locale),
              b: (c) => <strong className="text-[15px] whitespace-nowrap">{c}</strong>,
            })}
          </span>
        </div>
      ) : null}
      {steps ? <Steps /> : null}
    </>
  );
}

function Steps() {
  const t = useTranslations("ask");
  return (
    <>
      <ol className="flex flex-col gap-1.5 text-[15px] leading-snug">
        {(["step1", "step2", "step3"] as const).map((k, i) => (
          <li key={k} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-night text-[12px] font-bold text-lime"
            >
              {i + 1}
            </span>
            <span>
              <span className="sr-only">{i + 1}. </span>
              {t(k)}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * What happens and who does it, before the e-mail field (docs/UX_REVIEW_PLAN.md §5):
 * the response time and that it is free, the person who handles it, and the
 * anonymous proof that it has worked before.
 */
export function AskPromise({ signer, proof }: { signer?: string | null; proof?: string | null }) {
  const t = useTranslations("ask");
  return (
    <div className="flex flex-col gap-1 text-[15px] leading-snug" data-ask-promise>
      <p className="font-semibold">{t("promise")}</p>
      {signer && signer !== "Trilio" ? <p className="text-muted">{t("signer", { name: signer })}</p> : null}
      {proof ? (
        <p className="flex gap-2 font-semibold text-success" data-ask-proof>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <span>{proof}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Who sells and on what terms, and what the e-mail is for (panel, 14 Nov 2026: the most common
 * reason not to send was not knowing this). Says only what the purchase terms promise.
 */
export function AskTrust() {
  const t = useTranslations("ask");
  return (
    <p className="text-[14px] leading-snug text-muted" data-ask-trust>
      {t("trust")}{" "}
      <Link href="/pirkuma-noteikumi" className="font-semibold underline underline-offset-2">
        {t("trustTerms")}
      </Link>
    </p>
  );
}

/** The three steps and the honest caveat, folded: there for anyone who asks, not between the shopper and the button. */
export function HowItWorks() {
  const t = useTranslations("ask");
  return (
    <details className="group text-[15px]" data-ask-how>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold underline underline-offset-2">
        {t("how")}
      </summary>
      <div className="flex flex-col gap-2 pb-1">
        <Steps />
        <OfferFine />
      </div>
    </details>
  );
}

export function OfferFine() {
  const t = useTranslations("ask");
  return <p className="text-[13px] leading-snug text-muted">{t("fine")}</p>;
}
