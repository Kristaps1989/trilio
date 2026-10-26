import type { MetadataRoute } from "next";
import { allSubcategories, catalog } from "@/domain/questions/catalog";
import { appBaseUrl } from "@/services/payments";
import { languageAlternates } from "./[locale]/seo";
import { cachedLandingIndex } from "./[locale]/kategorija/landing-index";

// Built per request: the site URL comes from APP_URL at runtime, not at build time.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appBaseUrl();
  // Landing pages carry the day their picks last changed price; the others change only
  // when the site is deployed, so they carry no date (docs/SEO_INDEXING_PLAN.md §2D).
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/izvelies`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/modelis`, changeFrequency: "monthly", priority: 0.5 },
    ...["/noteikumi", "/pirkuma-noteikumi", "/privatums", "/sikdatnes", "/kontakti"].map((path) => ({
      url: `${base}${path}`,
      changeFrequency: "yearly" as const,
      priority: 0.2,
    })),
  ];
  for (const g of catalog.groups) {
    if (g.id !== "other")
      entries.push({
        url: `${base}/izvelies/${g.id}`,
        changeFrequency: "weekly",
        priority: 0.6,
      });
  }
  // Only the landing pages that keep their own address: a budget page repeating the base
  // page or a lower budget, and a base page with nothing in stock, stay out (§2A).
  const indexes = await Promise.all(allSubcategories().map((s) => cachedLandingIndex(s.id)));
  allSubcategories().forEach((s, i) => {
    const index = indexes[i] ?? null;
    const lastModified = (k: string) => {
      const iso = index?.lastChanged[k];
      return iso ? { lastModified: new Date(iso) } : {};
    };
    if (index && !index.decision.baseIndexed) return;
    entries.push({
      url: `${base}/kategorija/${s.id}`,
      ...lastModified("base"),
      changeFrequency: "daily",
      priority: 0.9,
    });
    for (const eur of s.budget_steps_eur) {
      if (index && index.decision.canonicalOf[eur] !== null) continue;
      entries.push({
        url: `${base}/kategorija/${s.id}/lidz-${eur}`,
        ...lastModified(String(eur)),
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
  });
  // Every page exists in Latvian (no prefix) and English (/en). Each address is
  // listed with all its language versions as hreflang alternates, as Google documents.
  return entries.flatMap((e) => {
    const path = e.url.slice(base.length) || "/";
    const languages = languageAlternates(path);
    return [
      { ...e, alternates: { languages } },
      { ...e, url: languages.en!, priority: (e.priority ?? 0.5) / 2, alternates: { languages } },
    ];
  });
}
