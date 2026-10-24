import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { offerMailDeps } from "@/services/offers/deps";
import { afterProblemReported } from "@/services/offers/notify";
import { orderByFeedbackToken, recordFeedback } from "@/services/offers/orders";
import { Button } from "@/ui/Button";
import { InfoBox, Kicker, PageTitle, Screen } from "@/ui/layout";

// "Vai viss kārtībā?" (docs/ADMIN_AND_OFFERS_PLAN.md §11.6): one question, two
// answers, from the e-mail link without signing in. Not a review, not a rating.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vai viss kārtībā?", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ atbilde?: string }> };

export default async function Feedback({ params, searchParams }: Props) {
  const { token } = await params;
  const t = await getTranslations("feedback");
  const order = await orderByFeedbackToken(db, token);
  if (!order) notFound();
  const { atbilde } = await searchParams;

  async function answer(formData: FormData) {
    "use server";
    const current = await orderByFeedbackToken(db, token);
    if (!current) notFound();
    const kind = formData.get("answer") === "problem" ? "problem" : "ok";
    const note = String(formData.get("note") ?? "").slice(0, 2000) || null;
    if (await recordFeedback(db, current, kind, note))
      if (kind === "problem") await afterProblemReported(db, current.id, note, offerMailDeps());
    redirect(`/pasutijums/${token}`);
  }

  if (order.feedback)
    return (
      <Screen size="narrow">
        <Kicker>{t("kicker")}</Kicker>
        <PageTitle>{order.feedback === "ok" ? t("thanksOk") : t("thanksProblem")}</PageTitle>
        <p className="text-[17px] text-stone" role="status">
          {order.feedback === "ok" ? t("thanksOkBody") : t("thanksProblemBody")}
        </p>
      </Screen>
    );

  return (
    <Screen size="narrow">
      <Kicker>{t("kicker")}</Kicker>
      <PageTitle>{t("title")}</PageTitle>
      {atbilde === "problema" ? (
        <form action={answer} className="flex flex-col gap-3">
          <input type="hidden" name="answer" value="problem" />
          <label className="flex flex-col gap-1.5 text-[15px] font-semibold text-mist">
            {t("what")}
            <textarea
              name="note"
              rows={4}
              required
              className="w-full rounded-control border-[1.5px] border-mist/35 bg-white-5 px-4 py-3 text-[17px] text-mist"
            />
          </label>
          <Button type="submit" size="lg">
            {t("send")}
          </Button>
        </form>
      ) : (
        <>
          <InfoBox>{t("body")}</InfoBox>
          <div className="flex flex-wrap gap-3">
            <form action={answer}>
              <input type="hidden" name="answer" value="ok" />
              <Button type="submit" size="lg">
                {t("ok")}
              </Button>
            </form>
            <a
              href={`/pasutijums/${token}?atbilde=problema`}
              className="inline-flex min-h-14 items-center rounded-button border-[1.5px] border-line-40 px-[26px] text-lg font-semibold text-mist"
            >
              {t("problem")}
            </a>
          </div>
        </>
      )}
    </Screen>
  );
}
