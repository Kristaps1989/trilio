import type { MetadataRoute } from "next";
import { allSubcategories, catalog } from "@/domain/questions/catalog";
import { appBaseUrl } from "@/services/payments";
import { languageAlternates } from "./[locale]/seo";

// Built per request: the site URL comes from APP_URL at runtime, not at build time.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appBaseUrl();
  // Landing pages change with the daily prices; the others only when the site is deployed,
  // so they carry no date (a lastmod that changes on every request is ignored by search engines).
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
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
  for (const s of allSubcategories()) {
    entries.push({
      url: `${base}/kategorija/${s.id}`,
      lastModified: today,
      changeFrequency: "daily",
      priority: 0.9,
    });
    for (const eur of s.budget_steps_eur) {
      entries.push({
        url: `${base}/kategorija/${s.id}/lidz-${eur}`,
        lastModified: today,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
  }
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
