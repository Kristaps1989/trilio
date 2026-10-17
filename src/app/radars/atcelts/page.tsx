import { getTranslations } from "next-intl/server";
import { PrimaryLink } from "@/ui/PrimaryButton";
import { Shell } from "@/ui/Shell";

type Props = { searchParams: Promise<{ next?: string }> };

/** cancel_url after the hosted checkout: nothing was charged. */
export default async function PaymentCanceledPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const t = await getTranslations("radar");
  const target =
    next && next.startsWith("/") && !next.startsWith("//")
      ? next.replace(/&step=create$/, "&step=plan")
      : "/radars";
  return (
    <Shell>
      <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">{t("canceledTitle")}</h1>
      <p className="mt-2 text-base text-stone">{t("canceledBody")}</p>
      <div className="mt-6 flex flex-col gap-3">
        <PrimaryLink href={target}>{t("pay")}</PrimaryLink>
        <PrimaryLink href="/radars" variant="secondary">
          {t("toRadar")}
        </PrimaryLink>
      </div>
    </Shell>
  );
}
