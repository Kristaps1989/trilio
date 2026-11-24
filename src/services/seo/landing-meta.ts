import { createTranslator } from "next-intl";
import { OFFER_DISCOUNT_UP_TO_PCT } from "@/domain/offers/discount";
import { trilioSources } from "@/domain/offers/sourcing";
import { getSubcategory } from "@/domain/questions/catalog";
import { landingOf } from "@/domain/seo/agent";
import { categoryGender, formatEur } from "@/i18n/format";
import lv from "@/i18n/messages/lv.json";

/**
 * A category page's own title and description in Latvian, as its template writes them
 * (the same words the page's generateMetadata uses): what the SEO agent reads as "current"
 * before it writes a better one. Null for an address that is not a category page.
 */
export function landingTemplateMeta(
  path: string,
  year: number,
): { title: string; description: string } | null {
  const landing = landingOf(path);
  const sub = landing ? getSubcategory(landing.sub) : null;
  if (!landing || !sub) return null;
  const t = createTranslator({ locale: "lv", messages: lv, namespace: "landing" });
  const category = sub.label.toLowerCase();
  const gender = categoryGender(sub.label);
  if (landing.budgetEur !== null) {
    const budget = formatEur(landing.budgetEur * 100, "lv");
    return {
      title: t("metaTitleBudget", { category, gender, budget, year }),
      description: t("descriptionBudget", { category, gender, budget }),
    };
  }
  return {
    title: t("metaTitle", { category, gender, year }),
    description: trilioSources(sub.id)
      ? t("descriptionOffers", { category, gender, pct: OFFER_DISCOUNT_UP_TO_PCT })
      : t("description", { category, gender }),
  };
}
