import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { currentSubscription, hasAccess } from "@/services/billing/engine";
import { ButtonLink } from "@/ui/Button";
import { Confirmation } from "@/ui/Confirmation";
import { localPath } from "@/i18n/path";

export const dynamic = "force-dynamic";

/**
 * accept_url after the hosted checkout. The provider's callback may arrive a
 * moment after the redirect, so this page continues to the wishlist only once
 * the subscription is active; otherwise it offers a refresh.
 */
export default async function PaymentAcceptedPage() {
  const t = await getTranslations("wishlist");
  const session = await auth();
  const target = "/velmju-saraksts?apmaksats=1";
  const userId = session?.user?.id;
  if (userId && hasAccess(await currentSubscription(db, userId))) redirect(await localPath(target));

  return (
    <Confirmation title={t("confirmTitle")} body={t("confirmBody")}>
      <ButtonLink href="/velmju-saraksts/apmaksats">{t("toList")}</ButtonLink>
    </Confirmation>
  );
}
