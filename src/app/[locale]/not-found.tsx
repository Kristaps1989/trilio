import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { activeLocale } from "@/i18n/active";
import { ButtonLink } from "@/ui/Button";
import { Kicker, Lead, PageTitle, Screen } from "@/ui/layout";

// The locale is passed explicitly: a 404 from an ISR landing page renders here
// without reading the request headers (which would make the page dynamic).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: activeLocale(), namespace: "errors" });
  return { title: t("notFoundTitle"), robots: { index: false } };
}

/** Branded 404 inside the normal header and footer. */
export default async function NotFound() {
  const t = await getTranslations({ locale: activeLocale(), namespace: "errors" });
  return (
    <Screen size="text">
      <Kicker>{t("notFoundKicker")}</Kicker>
      <PageTitle>{t("notFoundTitle")}</PageTitle>
      <Lead>{t("notFoundText")}</Lead>
      <div className="mt-2 flex flex-wrap gap-3">
        <ButtonLink href="/">{t("home")}</ButtonLink>
        <ButtonLink href="/izvelies" variant="outline">
          {t("categories")}
        </ButtonLink>
      </div>
    </Screen>
  );
}
