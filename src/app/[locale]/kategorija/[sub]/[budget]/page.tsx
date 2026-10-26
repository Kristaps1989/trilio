import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSubcategory } from "@/domain/questions/catalog";
import { categoryGender, formatEur } from "@/i18n/format";
import { pageMetadata } from "../../../seo";
import { landingCanonicalPath } from "@/domain/seo/landing-index";
import { cachedLandingIndex } from "../../landing-index";
import { LandingPage } from "../../LandingPage";
import { activeLocale } from "@/i18n/active";
import { initLocale } from "@/i18n/init";

export const revalidate = 3600;

type Props = { params: Promise<{ locale: string; sub: string; budget: string }> };

/**
 * One page per subcategory and budget step: /kategorija/fridge/lidz-800 (the
 * segment carries the "lidz-" prefix). Rendered on first request and cached
 * for an hour; the build has no database. Anything resolve() rejects is a 404.
 */
export function generateStaticParams(): { sub: string; budget: string }[] {
  return [];
}

function resolve(subId: string, budget: string) {
  const sub = getSubcategory(subId, activeLocale());
  const m = /^lidz-(\d{2,6})$/.exec(budget);
  const eur = m ? Number(m[1]) : NaN;
  if (!sub || !Number.isInteger(eur) || !sub.budget_steps_eur.includes(eur)) return null;
  return { sub, budgetCents: eur * 100 };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await initLocale(params);
  const { sub, budget } = await params;
  const r = resolve(sub, budget);
  if (!r) return {};
  const t = await getTranslations("landing");
  const category = r.sub.label.toLowerCase();
  const gender = categoryGender(r.sub.label);
  const title = t("metaTitleBudget", {
    category,
    gender,
    budget: formatEur(r.budgetCents),
    year: new Date().getFullYear(),
  });
  // A page with the same picks as the base page or a lower budget names that page as canonical.
  const index = await cachedLandingIndex(r.sub.id);
  return pageMetadata(
    `/kategorija/${r.sub.id}/${budget}`,
    title,
    t("descriptionBudget", { category, gender, budget: formatEur(r.budgetCents) }),
    landingCanonicalPath(r.sub.id, r.budgetCents / 100, index?.decision ?? null),
  );
}

export default async function CategoryBudgetLanding({ params }: Props) {
  await initLocale(params);
  const { sub, budget } = await params;
  const r = resolve(sub, budget);
  if (!r) notFound();
  return <LandingPage sub={r.sub} budgetCents={r.budgetCents} />;
}
