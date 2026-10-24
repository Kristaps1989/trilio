import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { pageMetadata } from "@/app/[locale]/seo";
import { companyFromEnv, fillCompany } from "@/config/company";
import NextLink from "next/link";
import { appBaseUrl } from "@/services/payments";
import { Kicker, Page, PageTitle } from "./layout";

/** The address of each legal page, for the link to the binding Latvian text. */
const PATHS: Record<string, string> = {
  privacy: "/privatums",
  terms: "/noteikumi",
  cookies: "/sikdatnes",
  contacts: "/kontakti",
  purchase: "/pirkuma-noteikumi",
};

type Section = { h: string; p?: string[]; items?: string[]; after?: string[] };

/**
 * One legal page (privacy, terms, cookies, contacts) from the `legal.<doc>`
 * messages. Company details come from configuration (src/config/company.ts).
 * A short "In short" summary opens the longer documents
 * (docs/ENGLISH_AND_ACCESSIBILITY_PLAN.md §5, item 10); in English a note says
 * the Latvian text is binding and links to it.
 */
export async function LegalDocument({ doc, children }: { doc: string; children?: ReactNode }) {
  const t = await getTranslations("legal");
  const locale = await getLocale();
  const summary = t.has(`${doc}.summary`) ? (t.raw(`${doc}.summary`) as string[]) : [];
  const company = companyFromEnv();
  const site = new URL(appBaseUrl()).host;
  const fill = (s: string) => fillCompany(s, company, site, t("notSet"));
  const sections = t.raw(`${doc}.sections`) as Section[];
  return (
    <Page size="text">
      <article className="flex flex-col gap-4 text-[17px] leading-relaxed text-mist">
        <div className="flex flex-col gap-2">
          <Kicker>{t("kicker")}</Kicker>
          <PageTitle>{t(`${doc}.title`)}</PageTitle>
          <p className="text-sm text-stone">{t("updated")}</p>
        </div>
        {locale === "en" ? (
          <p className="rounded-xl border border-line-25 p-4 text-base">
            {t("translationNote")}{" "}
            {/* A plain link: the Latvian page has no prefix, and next-intl's Link would add /lv. */}
            <NextLink href={PATHS[doc] ?? "/"} hrefLang="lv" className="underline">
              {t("translationLink")}
            </NextLink>
          </p>
        ) : null}
        <p className="text-lead text-stone">{fill(t.raw(`${doc}.intro`) as string)}</p>
        {summary.length ? (
          <section aria-labelledby="legal-summary" className="rounded-xl bg-white-5 p-4">
            <h2 id="legal-summary" className="font-heading text-[20px] font-semibold">
              {t("summaryTitle")}
            </h2>
            <ul className="mt-2 flex list-disc flex-col gap-2 pl-5">
              {summary.map((item) => (
                <li key={item}>{fill(item)}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {children}
        {sections.map((s) => (
          <section key={s.h} className="flex flex-col gap-2">
            <h2 className="pt-3 font-heading text-[22px] font-semibold">{s.h}</h2>
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
    </Page>
  );
}

/** Title, description and canonical URL for a legal page at `path` (e.g. "/privatums"). */
export async function legalMetadata(doc: string, path: string): Promise<Metadata> {
  const t = await getTranslations("legal");
  return pageMetadata(path, t(`${doc}.title`), t(`${doc}.description`));
}
