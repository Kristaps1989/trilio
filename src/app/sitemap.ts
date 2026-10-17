import type { MetadataRoute } from "next";
import { allSubcategories, catalog } from "@/domain/questions/catalog";
import { appBaseUrl } from "@/services/payments";

// Built per request: the site URL comes from APP_URL at runtime, not at build time.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appBaseUrl();
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/izvelies`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/modelis`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];
  for (const g of catalog.groups) {
    if (g.id !== "other")
      entries.push({
        url: `${base}/izvelies/${g.id}`,
        lastModified: now,
        changeFrequency: "weekly",
        priority: 0.6,
      });
  }
  for (const s of allSubcategories()) {
    entries.push({
      url: `${base}/kategorija/${s.id}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    });
    for (const eur of s.budget_steps_eur) {
      entries.push({
        url: `${base}/kategorija/${s.id}/lidz-${eur}`,
        lastModified: now,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
  }
  return entries;
}
