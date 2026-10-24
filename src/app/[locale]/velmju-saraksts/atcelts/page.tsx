import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/ui/Button";
import { Kicker, PageTitle, Screen } from "@/ui/layout";

/** cancel_url after the hosted checkout: nothing was charged. */
export default async function PaymentCanceledPage() {
  const t = await getTranslations("wishlist");
  return (
    <Screen size="medium">
      <Kicker>{t("planKicker")}</Kicker>
      <PageTitle>{t("canceledTitle")}</PageTitle>
      <p className="text-lg leading-normal text-stone">{t("canceledBody")}</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/velmju-saraksts">{t("toList")}</ButtonLink>
      </div>
    </Screen>
  );
}
