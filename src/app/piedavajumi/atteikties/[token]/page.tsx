import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { unsubscribeByToken } from "@/services/offers/offers";
import { Button } from "@/ui/Button";
import { Kicker, PageTitle, Screen } from "@/ui/layout";

// Unsubscribe from personal offers from the e-mail link: one button, no sign-in.
// (A page, not a GET that changes state, so link scanners cannot unsubscribe anyone.)

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Atteikties no piedāvājumiem",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> };

export default async function Unsubscribe({ params, searchParams }: Props) {
  const { token } = await params;
  const t = await getTranslations("unsubscribe");
  const { done } = await searchParams;

  async function confirm() {
    "use server";
    await unsubscribeByToken(db, token);
    redirect(`/piedavajumi/atteikties/${token}?done=1`);
  }

  return (
    <Screen size="narrow">
      <Kicker>{t("kicker")}</Kicker>
      {done ? (
        <>
          <PageTitle>{t("doneTitle")}</PageTitle>
          <p className="text-[17px] text-stone" role="status">
            {t("doneBody")}
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
