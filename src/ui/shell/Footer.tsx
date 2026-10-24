import { getTranslations } from "next-intl/server";
import type { UiLocale } from "@/i18n/routing";
import { LegalLinks } from "../LegalLinks";
import { BackButton } from "./BackButton";

/**
 * Row 1: back button and tagline (prototype). Row 2: legal links on every page.
 * The layout passes the locale: the footer also renders around a 404 from an
 * ISR page, where reading it from the request would make that page dynamic.
 */
export async function Footer({ locale }: { locale: UiLocale }) {
  const t = await getTranslations({ locale, namespace: "footer" });
  return (
    <footer className="flex flex-col gap-1 px-gutter pt-[14px] pb-5">
      <div className="flex items-center justify-between gap-3">
        <BackButton label={t("back")} />
        <span className="text-right text-[13px] text-stone">{t("tagline")}</span>
      </div>
      <LegalLinks locale={locale} />
    </footer>
  );
}
