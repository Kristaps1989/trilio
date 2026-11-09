import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { alertsUnsubscribeKind, unsubscribeAlerts } from "@/services/wishlist/alerts";
import { Button } from "@/ui/Button";
import { Kicker, PageTitle, Screen } from "@/ui/layout";
import { localPath } from "@/i18n/path";

// Stop price-drop e-mails from the e-mail link: one button, no sign-in.
// (A page, not a GET that changes state, so link scanners cannot unsubscribe anyone.)

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("alertsUnsubscribe");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> };

export default async function AlertsUnsubscribe({ params, searchParams }: Props) {
  const { token } = await params;
  const t = await getTranslations("alertsUnsubscribe");
  const { done } = await searchParams;
  const request = !done && (await alertsUnsubscribeKind(db, token)) === "request";

  async function confirm() {
    "use server";
    // An address never proven (a typed request) is deleted outright, as the receipt promises.
    const what = await unsubscribeAlerts(db, token);
    redirect(
      await localPath(`/velmju-saraksts/atteikties/${token}?done=${what === "request" ? "request" : "1"}`),
    );
  }

  return (
    <Screen size="narrow">
      <Kicker>{t("kicker")}</Kicker>
      {done ? (
        <>
          <PageTitle>{t("doneTitle")}</PageTitle>
          <p className="text-[17px] text-stone" role="status">
            {done === "request" ? t("doneRequest") : t("doneBody")}
          </p>
        </>
      ) : (
        <>
          <PageTitle>{t("title")}</PageTitle>
          <p className="text-[17px] text-stone">{t(request ? "requestBody" : "body")}</p>
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
