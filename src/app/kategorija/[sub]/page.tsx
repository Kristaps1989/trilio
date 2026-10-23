import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSubcategory } from "@/domain/questions/catalog";
import { categoryGender } from "@/i18n/format";
import { pageMetadata } from "../../seo";
import { LandingPage } from "../LandingPage";

export const revalidate = 3600;

type Props = { params: Promise<{ sub: string }> };

/**
 * Rendered on the first request, then cached for an hour (ISR). Nothing is
 * prerendered at build time, because the build has no database. Unknown ids
 * get a 404 below. The full list of pages is in sitemap.ts.
 */
export function generateStaticParams(): { sub: string }[] {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sub: id } = await params;
  const sub = getSubcategory(id);
  if (!sub) return {};
  const t = await getTranslations("landing");
  const category = sub.label.toLowerCase();
  const gender = categoryGender(sub.label);
  return pageMetadata(
    `/kategorija/${sub.id}`,
    t("metaTitle", { category, gender, year: new Date().getFullYear() }),
    t("description", { category, gender }),
  );
}

export default async function CategoryLanding({ params }: Props) {
  const { sub: id } = await params;
  const sub = getSubcategory(id);
  if (!sub) notFound();
  return <LandingPage sub={sub} budgetCents={null} />;
}
