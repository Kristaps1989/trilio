import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSubcategory } from "@/domain/questions/catalog";
import { appBaseUrl } from "@/services/payments";
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
  const title = t("title", { category: sub.label.toLowerCase() });
  return {
    title,
    description: t("description", { category: sub.label.toLowerCase() }),
    alternates: { canonical: `${appBaseUrl()}/kategorija/${sub.id}` },
    openGraph: { title, type: "website" },
  };
}

export default async function CategoryLanding({ params }: Props) {
  const { sub: id } = await params;
  const sub = getSubcategory(id);
  if (!sub) notFound();
  return <LandingPage sub={sub} budgetCents={null} />;
}
