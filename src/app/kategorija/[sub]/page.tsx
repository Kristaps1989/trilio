import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { allSubcategories, getSubcategory } from "@/domain/questions/catalog";
import { appBaseUrl } from "@/services/payments";
import { LandingPage } from "../LandingPage";

export const revalidate = 3600;
export const dynamicParams = false;

type Props = { params: Promise<{ sub: string }> };

export function generateStaticParams() {
  return allSubcategories().map((s) => ({ sub: s.id }));
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
