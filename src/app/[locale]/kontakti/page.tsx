import { getTranslations } from "next-intl/server";
import { companyFromEnv } from "@/config/company";
import { LegalDocument, legalMetadata } from "@/ui/LegalDocument";

// Company details come from runtime configuration, so the page renders per request.
export const dynamic = "force-dynamic";

export function generateMetadata() {
  return legalMetadata("contacts", "/kontakti");
}

export default async function Page() {
  const t = await getTranslations("legal");
  const c = companyFromEnv();
  const rows: [string, string][] = [
    [t("contacts.company"), c.name],
    [t("contacts.regNo"), c.regNo],
    ...(c.vatNo ? ([[t("contacts.vatNo"), c.vatNo]] as [string, string][]) : []),
    [t("contacts.address"), c.address],
  ];
  return (
    <LegalDocument doc="contacts">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-stone">{label}</dt>
            <dd className="mb-2 sm:mb-0">{value || t("notSet")}</dd>
          </div>
        ))}
        <dt className="text-stone">{t("contacts.email")}</dt>
        <dd>
          <a href={`mailto:${c.email}`} className="inline-flex min-h-11 items-center text-lime underline">
            {c.email}
          </a>
        </dd>
      </dl>
    </LegalDocument>
  );
}
