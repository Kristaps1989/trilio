import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSubcategory } from "@/domain/questions/catalog";
import { categoryGender } from "@/i18n/format";
import { NOINDEX, pageMetadata } from "../../seo";
import { cachedLandingIndex } from "../landing-index";
import { LandingPage } from "../LandingPage";
import { activeLocale } from "@/i18n/active";
import { initLocale } from "@/i18n/init";

export const revalidate = 3600;

type Props = { params: Promise<{ locale: string; sub: string }> };

/**
 * Rendered on the first request, then cached for an hour (ISR). Nothing is
 * prerendered at build time, because the build has no database. Unknown ids
 * get a 404 below. The full list of pages is in sitemap.ts.
 */
export function generateStaticParams(): { sub: string }[] {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await initLocale(params);
  const { sub: id } = await params;
  const sub = getSubcategory(id, activeLocale());
  if (!sub) return {};
  const t = await getTranslations("landing");
  const category = sub.label.toLowerCase();
  const gender = categoryGender(sub.label);
  const meta = pageMetadata(
    `/kategorija/${sub.id}`,
    t("metaTitle", { category, gender, year: new Date().getFullYear() }),
    t("description", { category, gender }),
  );
  // Nothing in stock: out of the index until it returns (docs/SEO_INDEXING_PLAN.md §2A).
  const index = await cachedLandingIndex(sub.id);
  return index && !index.decision.baseIndexed ? { ...meta, robots: NOINDEX } : meta;
}

export default async function CategoryLanding({ params }: Props) {
  await initLocale(params);
  const { sub: id } = await params;
  const sub = getSubcategory(id, activeLocale());
  if (!sub) notFound();
  return <LandingPage sub={sub} budgetCents={null} />;
}
