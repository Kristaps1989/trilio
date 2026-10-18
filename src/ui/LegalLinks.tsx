import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Terms, privacy, cookies and contacts: linked from every page's footer. */
export async function LegalLinks() {
  const t = await getTranslations("footer");
  const links = [
    ["/noteikumi", t("terms")],
    ["/privatums", t("privacy")],
    ["/sikdatnes", t("cookies")],
    ["/kontakti", t("contacts")],
  ] as const;
  return (
    <nav aria-label={t("legalNav")}>
      <ul className="flex flex-wrap gap-x-4">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="flex min-h-11 items-center text-sm text-stone underline">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
