"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { SaveTarget } from "@/app/[locale]/velmju-saraksts/save";
import { AskChoices } from "@/ui/AskChoices";
import { rememberAnswer } from "@/ui/askAnswer";
import { useRequest } from "@/ui/useRequest";

// The question before the shop as a page (docs/CLICK_QUALITY_PLAN.md §2): the
// same two choices as the card's sheet, for a click that reached /go/ before
// the results page's script could open the sheet.

export function AskPage(props: {
  target: SaveTarget;
  saved: boolean;
  offers: boolean;
  priceCents: number;
  shop: string;
  shopHref: string;
}) {
  const t = useTranslations("ask");
  const router = useRouter();
  const request = useRequest(props.target, props.saved);
  return (
    <>
      <AskChoices
        request={request}
        target={props.target}
        offers={props.offers}
        priceCents={props.priceCents}
        shop={props.shop}
        shopHref={props.shopHref}
        onClose={() => {
          rememberAnswer();
          request.closePanel();
        }}
      />
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex min-h-11 items-center self-start text-[15px] underline"
      >
        {t("back")}
      </button>
    </>
  );
}
