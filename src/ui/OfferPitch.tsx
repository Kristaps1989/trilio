"use client";

import { useLocale, useTranslations } from "next-intl";
import { OFFER_DISCOUNT_UP_TO_PCT, maxOfferSavingCents } from "@/domain/offers/discount";
import { formatEur } from "@/i18n/format";
import type { UiLocale } from "@/i18n/routing";

// What leaving an e-mail is worth, where Trilio sources (docs/PRICE_NOTIFY_PLAN.md
// §8.7): the lime "līdz −10 %" strip with the saving in euro for this product,
// then the three steps. One component for the question before the shop and for
// the card's own "Iegūt lētāk" (owner, 4 Nov 2026), so both say the same.

export function OfferPitch({ priceCents }: { priceCents?: number }) {
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

export function OfferFine() {
  const t = useTranslations("ask");
  return <p className="text-[13px] leading-snug text-muted">{t("fine")}</p>;
}
