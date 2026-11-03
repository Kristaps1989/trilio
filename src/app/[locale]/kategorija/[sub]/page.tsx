import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSubcategory } from "@/domain/questions/catalog";
import { categoryGender } from "@/i18n/format";
import { pageMetadata } from "../../seo";
import { trilioSources } from "@/domain/offers/sourcing";
import { OFFER_DISCOUNT_UP_TO_PCT } from "@/domain/offers/discount";
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
  return pageMetadata(
    `/kategorija/${sub.id}`,
    t("metaTitle", { category, gender, year: new Date().getFullYear() }),
    // Where Trilio sources, the description names the request and its "up to" discount (docs/PRICE_NOTIFY_PLAN.md §8.7).
    trilioSources(sub.id)
      ? t("descriptionOffers", { category, gender, pct: OFFER_DISCOUNT_UP_TO_PCT })
      : t("description", { category, gender }),
  );
}

export default async function CategoryLanding({ params }: Props) {
  await initLocale(params);
  const { sub: id } = await params;
  const sub = getSubcategory(id, activeLocale());
  if (!sub) notFound();
  return <LandingPage sub={sub} budgetCents={null} />;
}
