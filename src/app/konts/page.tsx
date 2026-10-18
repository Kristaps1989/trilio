import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { Button, ButtonLink, buttonClass } from "@/ui/Button";
import { Kicker, Page, PageTitle, Panel } from "@/ui/layout";
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
    <Page size="text">
      <div className="flex flex-col gap-2">
        <Kicker>{t("kicker")}</Kicker>
        <PageTitle scale="results">{t("title")}</PageTitle>
        <p className="text-[17px] text-stone">{ta("signedInAs", { email: session.user.email ?? "" })}</p>
      </div>

      <Panel className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold text-mist">{tr("title")}</h2>
        <p className="text-[15px] text-stone">{t("radarHint")}</p>
        <div>
          <ButtonLink href="/radars" size="sm">
            {t("openRadar")}
          </ButtonLink>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold text-mist">{t("export")}</h2>
        <p className="text-[15px] text-stone">{t("exportHint")}</p>
        <div>
          <a
            href="/api/account/export"
            download="trilio-dati.json"
            className={buttonClass({ variant: "outline", size: "sm" })}
          >
            {t("export")}
          </a>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold text-warning">{t("delete")}</h2>
        <p className="text-[15px] text-stone">{t("deleteHint")}</p>
        <DeleteAccount />
      </Panel>

      <section className="flex justify-end">
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <Button type="submit" variant="outline" size="sm">
            {ta("signOut")}
          </Button>
        </form>
      </section>
    </Page>
  );
}
