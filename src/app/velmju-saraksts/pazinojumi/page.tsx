import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, plans } from "@/db";
import { formatEur } from "@/i18n/format";
import { currentSubscription, hasAccess } from "@/services/billing/engine";
import { paymentsEnabled } from "@/services/payments";
import { Kicker, PageTitle, Screen } from "@/ui/layout";
import { NotifyWaitlist } from "./NotifyWaitlist";
import { PlanPicker } from "./PlanPicker";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("wishlist");
  return { title: t("notifyTitle") };
}

/** The paid extra of the wishlist: e-mail when a saved price drops (plan, then hosted checkout). */
export default async function NotifyPlanPage() {
  const t = await getTranslations("wishlist");
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect(`/ienakt?callbackUrl=${encodeURIComponent("/velmju-saraksts/pazinojumi")}`);
  if (hasAccess(await currentSubscription(db, userId))) redirect("/velmju-saraksts");
  const email = session.user?.email ?? "";

  const list = await db.select().from(plans).where(eq(plans.active, true));
  const monthly = list.find((x) => x.interval === "month");
  const annual = list.find((x) => x.interval === "year");
  return (
    <Screen size="narrow" gap="gap-4">
      <Kicker>{t("planKicker")}</Kicker>
      <PageTitle>{t("notifyOffTitle")}</PageTitle>
      <p className="text-[17px] text-stone">{t("notifyOffBody")}</p>
      {paymentsEnabled() && monthly && annual ? (
        <PlanPicker
          monthly={{ id: monthly.id, label: t("planMonthly", { price: formatEur(monthly.priceCents) }) }}
          annual={{
            id: annual.id,
            label: t("planAnnual", { price: formatEur(annual.priceCents) }),
            sublabel: t("planAnnualSub"),
          }}
          payLabel={t("pay")}
          note={`${t("payNote")} ${t("sendTo", { email })}`}
          features={[t("feature1"), t("feature2"), t("feature3")]}
          legal={t.rich("legalNote", {
            terms: (chunks) => (
              <Link href="/noteikumi" className="text-mist underline">
                {chunks}
              </Link>
            ),
          })}
        />
      ) : (
        <NotifyWaitlist email={email} note="wishlist notifications" />
      )}
    </Screen>
  );
}
