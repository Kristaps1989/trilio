import { getTranslations } from "next-intl/server";
import { LegalDocument, legalMetadata } from "@/ui/LegalDocument";

// Company details come from runtime configuration, so the page renders per request.
export const dynamic = "force-dynamic";

type Row = { name: string; purpose: string; duration: string };

export function generateMetadata() {
  return legalMetadata("cookies", "/sikdatnes");
}

export default async function Page() {
  const t = await getTranslations("legal.cookies");
  const rows = t.raw("rows") as Row[];
  return (
    <LegalDocument doc="cookies">
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("title")}>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-mist-32">
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t("tableName")}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t("tablePurpose")}
              </th>
              <th scope="col" className="py-2 font-semibold">
                {t("tableDuration")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-mist-32 align-top">
                <td className="py-2 pr-3 font-mono text-[13px]">{r.name}</td>
                <td className="py-2 pr-3">{r.purpose}</td>
                <td className="py-2">{r.duration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LegalDocument>
  );
}
