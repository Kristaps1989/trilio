import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { trackingEnabled } from "@/config/analytics";
import type { UiLocale } from "@/i18n/routing";
import { ConsentSettingsButton } from "./analytics/Analytics";

/** Terms, purchase terms, privacy, cookies and contacts: linked from every page's footer. */
export async function LegalLinks({ locale }: { locale: UiLocale }) {
  const t = await getTranslations({ locale, namespace: "footer" });
  const consent = await getTranslations({ locale, namespace: "consent" });
  const links = [
    ["/noteikumi", t("terms")],
    ["/pirkuma-noteikumi", t("purchase")],
    ["/privatums", t("privacy")],
    ["/sikdatnes", t("cookies")],
    ["/kontakti", t("contacts")],
  ] as const;
  return (
    <nav aria-label={t("legalNav")}>
      <ul className="flex flex-wrap gap-x-4 md:justify-end">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link
              href={href}
              className="flex min-h-11 items-center text-[13px] text-stone underline underline-offset-2"
            >
              {label}
            </Link>
          </li>
        ))}
        {trackingEnabled() ? (
          <li>
            <ConsentSettingsButton label={consent("settings")} />
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
