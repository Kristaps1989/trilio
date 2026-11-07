import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { companyFromEnv } from "@/config/company";
import { Link } from "@/i18n/navigation";
import { htmlLang } from "@/i18n/request";
import { activeLocale } from "@/i18n/active";
import { appBaseUrl } from "@/services/payments";
import { ButtonLink } from "@/ui/Button";
import { Container, Lead, PageTitle, SectionTitle } from "@/ui/layout";
import { pageMetadata } from "../seo";

// "Par Trilio" (docs/CLICK_QUALITY_PLAN.md §5): one page that says in plain
// words what Trilio is, where and by whom, so a search for the name has a page
// to show and the Organization in the site's structured data has a home.

// Company details come from runtime configuration, so the page renders per request.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("about");
  return pageMetadata("/par-trilio", t("metaTitle"), t("description"));
}

export default async function AboutPage() {
  const t = await getTranslations("about");
  const c = companyFromEnv();
  const base = appBaseUrl();
  const items = [t("what1"), t("what2"), t("what3"), t("what4")];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: t("title"),
    url: `${base}${activeLocale() === "en" ? "/en" : ""}/par-trilio`,
    inLanguage: htmlLang(activeLocale()),
    about: { "@id": `${base}/#organization` },
    isPartOf: { "@id": `${base}/#website` },
  };
  return (
    <Container size="text" className="flex flex-col gap-8 pt-4 pb-12" data-about>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="flex flex-col gap-4">
        <PageTitle>{t("title")}</PageTitle>
        <Lead>{t("lead")}</Lead>
      </div>

      <section aria-labelledby="about-what" className="flex flex-col gap-3">
        <SectionTitle id="about-what">{t("whatTitle")}</SectionTitle>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-base leading-normal text-mist">
          {items.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="about-how" className="flex flex-col gap-3">
        <SectionTitle id="about-how">{t("howTitle")}</SectionTitle>
        <p className="text-base leading-normal text-mist">{t("how")}</p>
      </section>

      <section aria-labelledby="about-company" className="flex flex-col gap-3">
        <SectionTitle id="about-company">{t("companyTitle")}</SectionTitle>
        <p className="text-base leading-normal text-mist">
          {c.name ? t("company", { company: c.name }) : t("companyPlain")}{" "}
          <a href={`mailto:${c.email}`} className="text-lime underline">
            {c.email}
          </a>
          {" · "}
          <Link href="/kontakti" className="text-lime underline">
            {t("contacts")}
          </Link>
        </p>
        <p className="text-sm text-stone">{t("name")}</p>
      </section>

      <div>
        <ButtonLink href="/izvelies" size="lg">
          {t("start")}
        </ButtonLink>
      </div>
    </Container>
  );
}
