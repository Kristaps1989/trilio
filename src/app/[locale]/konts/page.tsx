import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { Button, ButtonLink, buttonClass } from "@/ui/Button";
import { Kicker, Page, PageTitle, Panel } from "@/ui/layout";
import { db } from "@/db";
import { offersOptIn } from "@/services/offers/offers";
import { OffersConsent } from "@/ui/OffersConsent";
import { PriceAlertsSwitch } from "@/ui/PriceAlertsSwitch";
import { priceAlertsOn } from "@/services/wishlist/alerts";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { setEmailLanguageAction } from "./actions";
import { DeleteAccount } from "./DeleteAccount";
import { localPath } from "@/i18n/path";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("title") };
}

type Props = { searchParams: Promise<{ valoda?: string }> };

/** GDPR: data export and account deletion (spec §7); the e-mail language. */
export default async function AccountPage({ searchParams }: Props) {
  const t = await getTranslations("account");
  const ta = await getTranslations("auth");
  const tr = await getTranslations("wishlist");
  const session = await auth();
  if (!session?.user?.id) redirect(await localPath("/ienakt?callbackUrl=/konts"));
  const languageSaved = (await searchParams).valoda === "1";
  const [me] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, session.user.id));
  const emailLocale = me?.locale === "en" ? "en" : "lv";

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
          <ButtonLink href="/velmju-saraksts" size="sm">
            {t("openRadar")}
          </ButtonLink>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold text-mist">{t("ordersTitle")}</h2>
        <p className="text-[15px] text-stone">{t("ordersHint")}</p>
        <div>
          <ButtonLink href="/konts/pasutijumi" variant="outline" size="sm">
            {t("openOrders")}
          </ButtonLink>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold text-mist">{t("alertsTitle")}</h2>
        <PriceAlertsSwitch
          initial={await priceAlertsOn(db, session.user.id)}
          email={session.user.email ?? ""}
        />
      </Panel>

      <Panel className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold text-mist">{t("offersTitle")}</h2>
        <OffersConsent initial={await offersOptIn(db, session.user.id)} />
      </Panel>

      <Panel className="flex flex-col gap-3">
        <h2 id="valoda" className="font-heading text-xl font-semibold text-mist">
          {t("language")}
        </h2>
        <form action={setEmailLanguageAction} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[15px] text-stone">{t("languageHint")}</legend>
            {(["lv", "en"] as const).map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-3 text-[17px] text-mist">
                <input
                  type="radio"
                  name="locale"
                  value={value}
                  defaultChecked={emailLocale === value}
                  className="h-5 w-5 accent-lime"
                />
                <span lang={value}>{value === "lv" ? t("languageLv") : t("languageEn")}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="outline" size="sm">
              {t("languageSave")}
            </Button>
            {languageSaved ? (
              <p role="status" className="text-[15px] text-lime">
                {t("languageSaved")}
              </p>
            ) : null}
          </div>
        </form>
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
            await signOut({ redirectTo: await localPath("/") });
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
