import { Link } from "@/i18n/navigation";
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
import { bestOffer, eligibleOffers } from "@/domain/ranking/filters";
import { mainstreamCeilingCents, rank, type Pick } from "@/domain/ranking/rank";
import { whyItFits } from "@/domain/ranking/score";
import { categoryGender, formatDateDative, formatDateNominative, formatEur } from "@/i18n/format";
import { currentMarket } from "@/i18n/market";
import { appBaseUrl } from "@/services/payments";
import { ButtonLink } from "@/ui/Button";
import { Kicker, Page, PageTitle, Panel, SectionTitle } from "@/ui/layout";
import { cardMedia } from "../rezultati/card-media";
import { CardRow, ResultCard, type CardModel } from "../rezultati/ResultCard";
import { activeLocale } from "@/i18n/active";

// Phase 3 SEO landing pages: "Labākie ledusskapji līdz 800 €". Server-rendered
// from the same ranking as the guided flow, with no answers (stock + budget
// only), structured data for search engines, and a call to the guided flow.

export async function landingCards(sub: Subcategory, budgetCents: number | null) {
  const products = await loadCandidates(db, sub.id);
  // Without a budget: the usual price range, not the whole market up to the most expensive model.
  const ceilingCents =
    budgetCents === null
      ? mainstreamCeilingCents(
          products.flatMap((p) => {
            const best = bestOffer(eligibleOffers(p, "new", "two_weeks"));
            return best ? [best.priceCents] : [];
          }),
        )
      : null;
  const result = rank({
    products,
    sub,
    answers: {},
    budget: budgetCents ?? ceilingCents,
    urgency: "two_weeks",
    includeRefurbished: false,
  });
  return { result, products, ceilingCents };
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
    unknownData: null,
    energy: cost !== null && total !== null ? { cost10yCents: cost, totalCents: total } : null,
    otherOffers: [],
    savingVsMaxCents: null,
    upgrade: null,
    refurbished: null,
    sessionId: null,
    // Landing pages are cached for everyone: the heart starts empty and fills on tap.
    saved: false,
    ...cardMedia(pick.product),
  };
}

export async function LandingPage({ sub, budgetCents }: { sub: Subcategory; budgetCents: number | null }) {
  const t = await getTranslations("landing");
  const group = getGroupOfSubcategory(sub.id, activeLocale());
  const now = new Date();
  const energyPrice = energyPriceFromEnv();
  const { result, products, ceilingCents } = await landingCards(sub, budgetCents);
  const cards = result.picks.map((p) => toCard(p, sub, now, energyPrice));
  const label = sub.label.toLowerCase();
  const gender = categoryGender(sub.label);
  // Crawlable links between the landing pages of one group (fridges ↔ freezers).
  const related = (group?.subcategories ?? []).filter((s) => s.id !== sub.id);
  const title =
    budgetCents === null
      ? t("title", { category: label, gender })
      : t("titleBudget", { category: label, gender, budget: formatEur(budgetCents) });
  const base = appBaseUrl();
  const path =
    budgetCents === null ? `/kategorija/${sub.id}` : `/kategorija/${sub.id}/lidz-${budgetCents / 100}`;

  // Product photo for search results (Google's Product snippets want one), as an absolute URL.
  const photo = (p: Pick) => {
    const src = cardMedia(p.product).image.src;
    return src ? { image: new URL(src, base).toString() } : {};
  };
  // The product's new offers that can be bought now (the pick's own offer is always one of them).
  const shopsOf = (p: Pick) => {
    const list = p.product.offers.filter((o) => o.condition === "new" && o.stock !== "out");
    return list.length ? list : [p.offer];
  };
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
        ...photo(p),
        description:
          p.product.specs || t("productDescription", { name: p.product.name, shops: shopsOf(p).length }),
        // Trilio compares shops and sells nothing itself: an AggregateOffer (Google's
        // product snippets for comparison pages), not a merchant Offer that would need
        // our own return policy and shipping details.
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "EUR",
          lowPrice: (Math.min(...shopsOf(p).map((o) => o.priceCents)) / 100).toFixed(2),
          highPrice: (Math.max(...shopsOf(p).map((o) => o.priceCents)) / 100).toFixed(2),
          offerCount: shopsOf(p).length,
        },
      },
    })),
  };

  const faq = [
    { q: t("faq1q", { category: label, gender }), a: t("faq1a") },
    { q: t("faq2q"), a: t("faq2a") },
    { q: t("faq3q"), a: t("faq3a") },
  ];
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: t("breadcrumbHome"), item: `${base}/` },
      { "@type": "ListItem", position: 2, name: group?.label ?? "", item: `${base}/izvelies/${group?.id}` },
      { "@type": "ListItem", position: 3, name: title, item: `${base}${path}` },
    ],
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <Page size="wide" gap="gap-[22px]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify([jsonLd, breadcrumb, faqLd]) }}
      />
      <div className="flex flex-col gap-[10px]">
        <Kicker>{group?.label}</Kicker>
        <PageTitle scale="results">{title}</PageTitle>
        <p className="max-w-[760px] text-lg leading-[1.45] text-stone">
          {t("lead", { count: products.length, date: formatDateNominative(now) })}
          {ceilingCents !== null ? ` ${t("leadMainstream", { max: formatEur(ceilingCents) })}` : ""}
        </p>
      </div>

      <Panel tone="lime" className="flex flex-wrap items-center justify-between gap-x-5 gap-y-[14px]">
        <p className="min-w-0 flex-[1_1_320px] font-heading text-[22px] leading-tight font-semibold text-mist">
          {t("ctaTitle")}
        </p>
        <ButtonLink href={`/izvelies/${group?.id}/${sub.id}`}>{t("ctaButton")}</ButtonLink>
      </Panel>

      {cards.length ? (
        <CardRow>
          {cards.map((c) => (
            <ResultCard key={c.productId} card={c} />
          ))}
        </CardRow>
      ) : (
        <Panel tone="dashed" className="text-lg">
          {t("noOffers")}
        </Panel>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="faq-title" className="flex flex-col gap-3">
          <SectionTitle id="faq-title">{t("faqTitle")}</SectionTitle>
          {faq.map((f) => (
            <details
              key={f.q}
              className="group rounded-[14px] border-[1.5px] border-line-25 px-4 py-1 text-mist"
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                {f.q}
                <span aria-hidden="true" className="text-lime transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="pb-3 text-[15px] leading-normal text-stone">{f.a}</p>
            </details>
          ))}
        </section>

        <nav aria-labelledby="budgets-title" className="flex flex-col gap-3">
          <SectionTitle id="budgets-title">{t("budgets")}</SectionTitle>
          <ul className="flex flex-wrap gap-2">
            {sub.budget_steps_eur.map((eur) => (
              <li key={eur}>
                <Link
                  href={`/kategorija/${sub.id}/lidz-${eur}`}
                  className="flex min-h-11 items-center rounded-full bg-chip px-4 text-sm font-semibold text-mist transition-colors hover:bg-lime-18 aria-[current=page]:bg-lime aria-[current=page]:text-night"
                  aria-current={budgetCents === eur * 100 ? "page" : undefined}
                >
                  {t("upTo", { budget: formatEur(eur * 100) })}
                </Link>
              </li>
            ))}
          </ul>
          {related.length ? (
            <>
              <h2 id="related-title" className="mt-2 font-heading text-lg font-semibold text-mist">
                {t("related")}
              </h2>
              <ul aria-labelledby="related-title" className="flex flex-col">
                {related.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/kategorija/${s.id}`}
                      className="inline-flex min-h-11 items-center text-base text-mist underline underline-offset-2"
                    >
                      {t("title", { category: s.label.toLowerCase(), gender: categoryGender(s.label) })}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <Link
            href="/izvelies"
            className="inline-flex min-h-11 items-center text-base font-semibold text-lime underline underline-offset-2"
          >
            {t("allCategories")}
          </Link>
        </nav>
      </div>
    </Page>
  );
}
