import type { Company } from "@/config/company";

// Site-level structured data (docs/CLICK_QUALITY_PLAN.md §5): who Trilio is, so
// a search for the name finds this site and not another company of the same
// name. One Organization (with its legal name, contact, country and its
// profiles elsewhere) and one WebSite published by it, with "trilio.lv" as the
// site's alternate name, as Google's site-name guidance asks.

export function siteJsonLd(input: {
  base: string;
  inLanguage: string;
  tagline: string;
  description: string;
  company: Company;
  profiles: string[];
}) {
  const { base, company } = input;
  const host = new URL(base).host;
  const org = `${base}/#organization`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": org,
      name: "Trilio",
      alternateName: [host],
      url: base,
      // A raster logo of at least 112 px, as Google asks for the logo in search results.
      logo: `${base}/icon-512.png`,
      slogan: input.tagline,
      description: input.description,
      email: company.email,
      ...(company.name ? { legalName: company.name } : {}),
      ...(company.vatNo ? { vatID: company.vatNo } : {}),
      ...(company.address
        ? { address: { "@type": "PostalAddress", streetAddress: company.address, addressCountry: "LV" } }
        : {}),
      areaServed: { "@type": "Country", name: "Latvia" },
      knowsLanguage: ["lv", "en"],
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: company.email,
        availableLanguage: ["Latvian", "English"],
        areaServed: "LV",
      },
      ...(input.profiles.length ? { sameAs: input.profiles } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${base}/#website`,
      name: "Trilio",
      alternateName: [host],
      url: base,
      inLanguage: input.inLanguage,
      publisher: { "@id": org },
      // No SearchAction: Google retired the sitelinks search box it served, and it only
      // crawled the literal template (/modelis?q={search_term_string}, Search Console, 9 Nov 2026).
    },
  ];
}
