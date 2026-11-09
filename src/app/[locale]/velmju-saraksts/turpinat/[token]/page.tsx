import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { renewAlertsByToken } from "@/services/wishlist/alerts";
import { Button } from "@/ui/Button";
import { Kicker, PageTitle, Screen } from "@/ui/layout";
import { localPath } from "@/i18n/path";

// "Turpināt vēl 90 dienas" from the e-mail sent 7 days before the price e-mails end
// (docs/ALERTS_WITHOUT_CONFIRM_PLAN.md): one button, no sign-in. A page, not a GET
// that changes state, so a mail scanner cannot renew anything.

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("renew");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> };

export default async function RenewAlerts({ params, searchParams }: Props) {
  const { token } = await params;
  const t = await getTranslations("renew");
  const { done } = await searchParams;

  async function confirm() {
    "use server";
    const until = await renewAlertsByToken(db, token);
    redirect(await localPath(`/velmju-saraksts/turpinat/${token}?done=${until ? "1" : "gone"}`));
  }

  return (
    <Screen size="narrow">
      <Kicker>{t("kicker")}</Kicker>
      {done ? (
        <>
          <PageTitle>{done === "1" ? t("doneTitle") : t("title")}</PageTitle>
          <p className="text-[17px] text-stone" role="status">
            {done === "1" ? t("doneBody") : t("gone")}
          </p>
        </>
      ) : (
        <>
          <PageTitle>{t("title")}</PageTitle>
          <p className="text-[17px] text-stone">{t("body")}</p>
          <form action={confirm}>
            <Button type="submit" size="lg">
              {t("confirm")}
            </Button>
          </form>
        </>
      )}
    </Screen>
  );
}
