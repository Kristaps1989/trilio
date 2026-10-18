import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { companyFromEnv, fillCompany } from "@/config/company";
import { appBaseUrl } from "@/services/payments";
import { Shell } from "./Shell";

type Section = { h: string; p?: string[]; items?: string[]; after?: string[] };

/**
 * One legal page (privacy, terms, cookies, contacts) from the `legal.<doc>`
 * messages. Company details come from configuration (src/config/company.ts).
 */
export async function LegalDocument({ doc, children }: { doc: string; children?: ReactNode }) {
  const t = await getTranslations("legal");
  const company = companyFromEnv();
  const site = new URL(appBaseUrl()).host;
  const fill = (s: string) => fillCompany(s, company, site, t("notSet"));
  const sections = t.raw(`${doc}.sections`) as Section[];
  return (
    <Shell>
      <article className="flex max-w-prose flex-col gap-4 pt-4 text-base leading-relaxed text-mist">
        <h1 className="text-[28px] font-bold leading-[1.2]">{t(`${doc}.title`)}</h1>
        <p className="text-sm text-stone">{t("updated")}</p>
        <p>{fill(t.raw(`${doc}.intro`) as string)}</p>
        {children}
        {sections.map((s) => (
          <section key={s.h} className="flex flex-col gap-2">
            <h2 className="pt-2 text-xl font-bold">{s.h}</h2>
            {s.p?.map((para) => (
              <p key={para}>{fill(para)}</p>
            ))}
            {s.items ? (
              <ul className="flex list-disc flex-col gap-2 pl-5">
                {s.items.map((item) => (
                  <li key={item}>{fill(item)}</li>
                ))}
              </ul>
            ) : null}
            {s.after?.map((para) => (
              <p key={para}>{fill(para)}</p>
            ))}
          </section>
        ))}
      </article>
    </Shell>
  );
}

/** Title, description and canonical URL for a legal page at `path` (e.g. "/privatums"). */
export async function legalMetadata(doc: string, path: string): Promise<Metadata> {
  const t = await getTranslations("legal");
  return {
    title: t(`${doc}.title`),
    description: t(`${doc}.description`),
    alternates: { canonical: `${appBaseUrl()}${path}` },
  };
}
