import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { requestByToken } from "@/services/notify/requests";
import { requestState } from "@/domain/notify/notify";
import { offerProductName } from "@/services/offers/compose";
import { Button, ButtonLink } from "@/ui/Button";
import { Kicker, Page, PageTitle } from "@/ui/layout";
import { confirmNotifyAction } from "./actions";

// The link in the confirmation e-mail (docs/PRICE_NOTIFY_PLAN.md §2 step 5).
// A page with one button, not a GET that confirms: mail scanners open links,
// and only the person should say yes.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notify");
  return { title: t("confirmTitle"), robots: { index: false, follow: false } };
}

export default async function ConfirmNotify({ params }: Props) {
  const { token } = await params;
  const t = await getTranslations("notify");
  const request = await requestByToken(db, token);
  const ok = !!request && requestState(request, new Date()).confirmable;
  // The page repeats the promise the request was made under: a better price where Trilio sources, else the price e-mail.
  const p = request?.offers === false ? "Plain" : "";
  return (
    <Page size="narrow">
      <Kicker>{t(`confirmKicker${p}`)}</Kicker>
      <PageTitle>{t(`confirmTitle${p}`)}</PageTitle>
      {ok ? (
        <form action={confirmNotifyAction} className="flex flex-col gap-5">
          <input type="hidden" name="token" value={token} />
          <p className="text-[17px] text-mist">
            {request.kind === "product"
              ? t(`confirmProduct${p}`, { email: request.email, name: offerProductName(request.label ?? "") })
              : t(`confirmSearch${p}`, { email: request.email, name: request.label ?? "" })}
          </p>
          <Button type="submit" size="lg">
            {t("confirmButton")}
          </Button>
        </form>
      ) : (
        <>
          <p className="text-[17px] text-stone" role="status">
            {t("confirmGone")}
          </p>
          <ButtonLink href="/" variant="outline">
            {t("toHome")}
          </ButtonLink>
        </>
      )}
    </Page>
  );
}
