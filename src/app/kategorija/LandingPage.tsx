import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { loadCandidates } from "@/db/queries/catalog";
import { deliveryDate, workingDaysUntil } from "@/domain/delivery/delivery";
import {
  ENERGY_SUBCATEGORIES,
  energyCost10yCents,
  energyPriceFromEnv,
  tcoCents,
} from "@/domain/energy/energy";
import { priceLine } from "@/domain/pricing/omnibus";
import { getGroupOfSubcategory } from "@/domain/questions/catalog";
import type { Subcategory } from "@/domain/questions/schema";
import { rank, type Pick } from "@/domain/ranking/rank";
import { whyItFits } from "@/domain/ranking/score";
import { formatDateDative, formatDateNominative, formatEur } from "@/i18n/format";
import { currentMarket } from "@/i18n/market";
import { appBaseUrl } from "@/services/payments";
import { PrimaryLink } from "@/ui/PrimaryButton";
import { Shell } from "@/ui/Shell";
import { ResultCard, type CardModel } from "../rezultati/ResultCard";

// Phase 3 SEO landing pages: "Labākie ledusskapji līdz 800 €". Server-rendered
// from the same ranking as the guided flow, with no answers (stock + budget
// only), structured data for search engines, and a call to the guided flow.

export async function landingCards(sub: Subcategory, budgetCents: number | null) {
  const products = await loadCandidates(db, sub.id);
  const result = rank({
    products,
    sub,
    answers: {},
    budgetCents,
    urgency: "two_weeks",
    includeRefurbished: false,
  });
  return { result, products };
}

function toCard(pick: Pick, sub: Subcategory, now: Date, energyPrice: number): CardModel {
  const date = deliveryDate(pick.offer, now, currentMarket().country);
  const cost = ENERGY_SUBCATEGORIES.has(sub.id)
    ? energyCost10yCents(pick.product.kwhYear, energyPrice)
    : null;
  const total = cost !== null ? tcoCents(pick.offer.priceCents, pick.product.kwhYear, energyPrice) : null;
  return {
    productId: pick.product.id,
    name: pick.product.name,
    modelCode: pick.product.modelCode,
    ean: pick.product.ean,
    specs: pick.product.specs,
    tier: pick.tier,
    recommended: pick.recommended,
    rating: pick.product.rating,
    best: {
      id: pick.offer.id,
      storeName: pick.offer.storeName,
      priceCents: pick.offer.priceCents,
      stock: pick.offer.stock === "soon" ? "soon" : "in",
      deliveryDate: date ? formatDateDative(date) : null,
      deliveryDays: workingDaysUntil(pick.offer),
    },
    overBudgetByCents: 0,
    priceLine: priceLine(pick.offer.priceCents, pick.offer.lowest30dCents),
    whyFits: whyItFits(pick.reasons),
    unconfirmed: [],
    energy: cost !== null && total !== null ? { cost10yCents: cost, totalCents: total } : null,
    otherOffers: [],
    savingVsMaxCents: null,
    upgrade: null,
    refurbished: null,
    sessionId: null,
    trackHref: `/radars/jauns?product=${pick.product.id}`,
  };
}

export async function LandingPage({ sub, budgetCents }: { sub: Subcategory; budgetCents: number | null }) {
  const t = await getTranslations("landing");
  const group = getGroupOfSubcategory(sub.id);
  const now = new Date();
  const energyPrice = energyPriceFromEnv();
  const { result, products } = await landingCards(sub, budgetCents);
  const cards = result.picks.map((p) => toCard(p, sub, now, energyPrice));
  const label = sub.label.toLowerCase();
  const title =
    budgetCents === null
      ? t("title", { category: label })
      : t("titleBudget", { category: label, budget: formatEur(budgetCents) });
  const base = appBaseUrl();
  const path =
    budgetCents === null ? `/kategorija/${sub.id}` : `/kategorija/${sub.id}/lidz-${budgetCents / 100}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: title,
    url: `${base}${path}`,
    itemListElement: result.picks.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Product",
        name: p.product.name,
        sku: p.product.modelCode,
        ...(p.product.ean ? { gtin13: p.product.ean } : {}),
        brand: { "@type": "Brand", name: p.product.brand },
        offers: {
          "@type": "Offer",
          priceCurrency: "EUR",
          price: (p.offer.priceCents / 100).toFixed(2),
          availability: p.offer.stock === "in" ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
          url: `${base}/go/${p.offer.id}`,
          seller: { "@type": "Organization", name: p.offer.storeName },
        },
      },
    })),
  };

  return (
    <Shell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="pt-4 text-sm font-semibold text-stone">{group?.label}</p>
      <h1 className="mt-1 text-[28px] font-bold leading-[1.2] text-mist">{title}</h1>
      <p className="mt-2 text-base text-stone">
        {t("lead", { count: products.length, date: formatDateNominative(now) })}
      </p>

      <div className="mt-6">
        <PrimaryLink href={`/izvelies/${group?.id}/${sub.id}`}>{t("cta")}</PrimaryLink>
      </div>

      {cards.length ? (
        <div className="mt-6 flex flex-col gap-4">
          {cards.map((c) => (
            <ResultCard key={c.productId} card={c} />
          ))}
        </div>
      ) : (
        <p className="mt-6 text-base text-stone">{t("noOffers")}</p>
      )}

      <nav aria-label={t("budgets")} className="mt-8">
        <h2 className="text-lg font-bold text-mist">{t("budgets")}</h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {sub.budget_steps_eur.map((eur) => (
            <li key={eur}>
              <Link
                href={`/kategorija/${sub.id}/lidz-${eur}`}
                className="flex min-h-11 items-center rounded-full border border-mist-32 bg-white-5 px-4 text-sm font-semibold text-mist"
                aria-current={budgetCents === eur * 100 ? "page" : undefined}
              >
                {t("upTo", { budget: formatEur(eur * 100) })}
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href="/izvelies"
          className="mt-4 inline-flex min-h-11 items-center text-base font-semibold text-lime"
        >
          {t("allCategories")}
        </Link>
      </nav>
    </Shell>
  );
}
