import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { localPath } from "@/i18n/path";
import { declineAlternative } from "@/services/admin/outcomes";
import { offerByToken } from "@/services/offers/offers";
import { Button, ButtonLink } from "@/ui/Button";
import { Kicker, PageTitle, Screen } from "@/ui/layout";

// "Gribu tikai pieprasīto modeli" (docs/ALTERNATIVE_OFFER_PLAN.md §4.1): the e-mail's
// link opens this page and one button confirms it, so a mail scanner opening links
// never answers for the shopper. The alternative is withdrawn; the price of the
// model asked for is still followed.

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("altAnswer");
  return { title: t("declineTitle"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> };

export default async function DeclineAlternative({ params, searchParams }: Props) {
  const { token } = await params;
  const { done } = await searchParams;
  const t = await getTranslations("altAnswer");
  const offer = await offerByToken(db, token);
  if (!offer?.alternativeToName) notFound();
  const asked = offer.alternativeToName;

  async function confirm() {
    "use server";
    await declineAlternative(db, token);
    redirect(await localPath(`/piedavajums/${token}/atteikt?done=1`));
  }

  const open = offer.status === "sent" || offer.status === "opened";
  return (
    <Screen size="narrow">
      <Kicker>{t("kicker")}</Kicker>
      {done || offer.declinedAt ? (
        <>
          <PageTitle>{t("declinedTitle")}</PageTitle>
          <p className="text-[17px] text-stone" role="status" data-declined>
            {t("declinedBody", { asked })}
          </p>
        </>
      ) : open ? (
        <>
          <PageTitle>{t("declineTitle")}</PageTitle>
          <p className="text-[17px] text-stone">{t("declineBody", { asked, offered: offer.productName })}</p>
          <form action={confirm} className="flex flex-wrap gap-3">
            <Button type="submit" size="lg" data-testid="confirm-decline">
              {t("declineConfirm")}
            </Button>
            <ButtonLink href={`/piedavajums/${token}`} variant="outline" size="lg">
              {t("backToOffer")}
            </ButtonLink>
          </form>
        </>
      ) : (
        <>
          <PageTitle>{t("closedTitle")}</PageTitle>
          <p className="text-[17px] text-stone" role="status">
            {t("closedBody")}
          </p>
        </>
      )}
    </Screen>
  );
}
