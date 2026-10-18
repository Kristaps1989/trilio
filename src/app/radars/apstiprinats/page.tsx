import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { currentSubscription, hasAccess } from "@/services/billing/engine";
import { ButtonLink } from "@/ui/Button";
import { Confirmation } from "@/ui/Confirmation";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ next?: string }> };

/**
 * accept_url after the hosted checkout. The provider's callback may arrive a
 * moment after the redirect, so this page continues to the radar creation
 * step only once the subscription is active; otherwise it offers a refresh.
 */
export default async function PaymentAcceptedPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const t = await getTranslations("radar");
  const session = await auth();
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/radars";
  const userId = session?.user?.id;
  if (userId && hasAccess(await currentSubscription(db, userId))) redirect(target);

  return (
    <Confirmation title={t("confirmTitle")} body={t("confirmBody")}>
      <ButtonLink href={`/radars/apstiprinats?next=${encodeURIComponent(target)}`}>{t("toRadar")}</ButtonLink>
    </Confirmation>
  );
}
