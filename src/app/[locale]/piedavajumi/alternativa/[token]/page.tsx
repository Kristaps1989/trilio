import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { products } from "@/db/schema";
import { eq } from "drizzle-orm";
import { localPath } from "@/i18n/path";
import { answerAsk, outcomeByToken } from "@/services/admin/outcomes";
import { offerMailDeps } from "@/services/offers/deps";
import { Button, ButtonLink } from "@/ui/Button";
import { Kicker, PageTitle, Screen } from "@/ui/layout";

// "Gribi, lai piedāvājam līdzvērtīgu?" (docs/ALTERNATIVE_OFFER_PLAN.md §4.3): the
// e-mail's "Jā" and "Nē" open this page with the answer chosen, and one button
// confirms it (a mail scanner opening links never answers). "Jā" sends the offer
// at once; "Nē" keeps only the price alert.

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("altAnswer");
  return { title: t("askTitle"), robots: { index: false, follow: false } };
}

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ atbilde?: string; done?: string; offer?: string }>;
};

export default async function AlternativeAnswer({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  const t = await getTranslations("altAnswer");
  const row = await outcomeByToken(db, token);
  if (!row || row.outcome !== "alternative_asked") notFound();
  const [product] = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, row.productId));
  const asked = product?.name ?? "";
  const chosen = sp.atbilde === "ne" ? "no" : sp.atbilde === "ja" ? "yes" : null;

  async function answer(formData: FormData) {
    "use server";
    const value = formData.get("answer") === "no" ? "no" : "yes";
    const res = await answerAsk(db, token, value, offerMailDeps());
    const q = res.ok
      ? `done=${res.answer}${res.offerToken ? `&offer=${res.offerToken}` : ""}`
      : `done=expired`;
    redirect(await localPath(`/piedavajumi/alternativa/${token}?${q}`));
  }

  const done = sp.done ?? row.answer ?? null;
  if (done) {
    return (
      <Screen size="narrow">
        <Kicker>{t("kicker")}</Kicker>
        <PageTitle>
          {done === "yes" ? t("yesTitle") : done === "no" ? t("noTitle") : t("expiredTitle")}
        </PageTitle>
        <p className="text-[17px] text-stone" role="status" data-answer={done}>
          {done === "yes" ? t("yesBody") : done === "no" ? t("noBody", { asked }) : t("expiredBody")}
        </p>
        {done === "yes" && sp.offer && /^[A-Za-z0-9_-]{20,64}$/.test(sp.offer) ? (
          <div>
            <ButtonLink href={`/piedavajums/${sp.offer}`} size="lg">
              {t("openOffer")}
            </ButtonLink>
          </div>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen size="narrow">
      <Kicker>{t("kicker")}</Kicker>
      <PageTitle>{t("askTitle")}</PageTitle>
      <p className="text-[17px] text-stone">{t("askBody", { asked })}</p>
      <form action={answer} className="flex flex-col gap-3">
        <Button
          type="submit"
          name="answer"
          value="yes"
          size="lg"
          variant={chosen === "no" ? "outline" : "primary"}
          data-testid="answer-yes"
        >
          {t("yes")}
        </Button>
        <Button
          type="submit"
          name="answer"
          value="no"
          size="lg"
          variant={chosen === "no" ? "primary" : "outline"}
          data-testid="answer-no"
        >
          {t("no")}
        </Button>
      </form>
    </Screen>
  );
}
