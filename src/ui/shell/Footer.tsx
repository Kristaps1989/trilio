import { getTranslations } from "next-intl/server";
import { LegalLinks } from "../LegalLinks";
import { BackButton } from "./BackButton";

/** Row 1: back button and tagline (prototype). Row 2: legal links on every page. */
export async function Footer() {
  const t = await getTranslations("footer");
  return (
    <footer className="flex flex-col gap-1 px-gutter pt-[14px] pb-5">
      <div className="flex items-center justify-between gap-3">
        <BackButton label={t("back")} />
        <span className="text-right text-[13px] text-stone">{t("tagline")}</span>
      </div>
      <LegalLinks />
    </footer>
  );
}
