import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/ui/Button";
import { Kicker, PageTitle, Screen } from "@/ui/layout";

type Props = { searchParams: Promise<{ next?: string }> };

/** cancel_url after the hosted checkout: nothing was charged. */
export default async function PaymentCanceledPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const t = await getTranslations("radar");
  const target =
    next && next.startsWith("/") && !next.startsWith("//")
      ? next.replace(/&step=create$/, "&step=plan")
      : "/radars";
  return (
    <Screen size="medium">
      <Kicker>{t("planKicker")}</Kicker>
      <PageTitle>{t("canceledTitle")}</PageTitle>
      <p className="text-lg leading-normal text-stone">{t("canceledBody")}</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href={target}>{t("pay")}</ButtonLink>
        <ButtonLink href="/radars" variant="outline">
          {t("toRadar")}
        </ButtonLink>
      </div>
    </Screen>
  );
}
