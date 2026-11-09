import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { unsubscribeByToken, unsubscribeKind } from "@/services/offers/offers";
import { Button } from "@/ui/Button";
import { Kicker, PageTitle, Screen } from "@/ui/layout";
import { localPath } from "@/i18n/path";

// Unsubscribe from personal offers from the e-mail link: one button, no sign-in.
// (A page, not a GET that changes state, so link scanners cannot unsubscribe anyone.)

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("unsubscribe");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> };

export default async function Unsubscribe({ params, searchParams }: Props) {
  const { token } = await params;
  const t = await getTranslations("unsubscribe");
  const { done } = await searchParams;
  // A proposal to an unconfirmed "Iegūt lētāk" request: no account, so no wishlist to keep.
  // Once done the request is gone, so the redirect carries which kind it was.
  const request = done ? done === "request" : (await unsubscribeKind(db, token)) === "request";

  async function confirm() {
    "use server";
    const kind = await unsubscribeKind(db, token);
    await unsubscribeByToken(db, token);
    redirect(
      await localPath(`/piedavajumi/atteikties/${token}?done=${kind === "request" ? "request" : "1"}`),
    );
  }

  return (
    <Screen size="narrow">
      <Kicker>{t("kicker")}</Kicker>
      {done ? (
        <>
          <PageTitle>{t("doneTitle")}</PageTitle>
          <p className="text-[17px] text-stone" role="status">
            {t(request ? "requestDoneBody" : "doneBody")}
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
