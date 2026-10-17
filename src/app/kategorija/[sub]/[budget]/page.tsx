import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { allSubcategories, getSubcategory } from "@/domain/questions/catalog";
import { formatEur } from "@/i18n/format";
import { appBaseUrl } from "@/services/payments";
import { LandingPage } from "../../LandingPage";

export const revalidate = 3600;
export const dynamicParams = false;

type Props = { params: Promise<{ sub: string; budget: string }> };

/** One page per subcategory and budget step: /kategorija/fridge/lidz-800 (the segment carries the "lidz-" prefix). */
export function generateStaticParams() {
  return allSubcategories().flatMap((s) =>
    s.budget_steps_eur.map((eur) => ({ sub: s.id, budget: `lidz-${eur}` })),
  );
}

function resolve(subId: string, budget: string) {
  const sub = getSubcategory(subId);
  const m = /^lidz-(\d{2,6})$/.exec(budget);
  const eur = m ? Number(m[1]) : NaN;
  if (!sub || !Number.isInteger(eur) || !sub.budget_steps_eur.includes(eur)) return null;
  return { sub, budgetCents: eur * 100 };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sub, budget } = await params;
  const r = resolve(sub, budget);
  if (!r) return {};
  const t = await getTranslations("landing");
  const title = t("titleBudget", { category: r.sub.label.toLowerCase(), budget: formatEur(r.budgetCents) });
  return {
    title,
    description: t("descriptionBudget", {
      category: r.sub.label.toLowerCase(),
      budget: formatEur(r.budgetCents),
    }),
    alternates: { canonical: `${appBaseUrl()}/kategorija/${r.sub.id}/${budget}` },
    openGraph: { title, type: "website" },
  };
}

export default async function CategoryBudgetLanding({ params }: Props) {
  const { sub, budget } = await params;
  const r = resolve(sub, budget);
  if (!r) notFound();
  return <LandingPage sub={r.sub} budgetCents={r.budgetCents} />;
}
