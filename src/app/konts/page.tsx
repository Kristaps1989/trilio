import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { PrimaryLink } from "@/ui/PrimaryButton";
import { Shell } from "@/ui/Shell";
import { DeleteAccount } from "./DeleteAccount";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("title") };
}

/** GDPR: data export and account deletion (spec §7). */
export default async function AccountPage() {
  const t = await getTranslations("account");
  const ta = await getTranslations("auth");
  const tr = await getTranslations("radar");
  const session = await auth();
  if (!session?.user?.id) redirect("/ienakt?callbackUrl=/konts");

  return (
    <Shell>
      <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">{t("title")}</h1>
      <p className="mt-2 text-base text-stone">{ta("signedInAs", { email: session.user.email ?? "" })}</p>

      <section className="mt-8 flex flex-col gap-2">
        <h2 className="text-lg font-bold text-mist">{t("export")}</h2>
        <p className="text-sm text-stone">{t("exportHint")}</p>
        <a
          href="/api/account/export"
          download="trilio-dati.json"
          className="flex min-h-14 items-center justify-center rounded-button border-[1.5px] border-mist-32 bg-white-5 px-6 text-lg font-semibold text-mist"
        >
          {t("export")}
        </a>
      </section>

      <section className="mt-8 flex flex-col gap-2">
        <h2 className="text-lg font-bold text-warning">{t("delete")}</h2>
        <p className="text-sm text-stone">{t("deleteHint")}</p>
        <DeleteAccount />
      </section>

      <div className="mt-8">
        <PrimaryLink href="/radars" variant="secondary">
          {tr("title")}
        </PrimaryLink>
      </div>
    </Shell>
  );
}
