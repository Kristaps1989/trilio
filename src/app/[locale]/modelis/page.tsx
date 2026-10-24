import { cleanName } from "@/domain/catalog/naming";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { loadCandidates, searchProducts } from "@/db/queries/catalog";
import { savedKeys } from "@/db/queries/wishlist";
import { productKey } from "@/domain/wishlist/wishlist";
import { currentUserId } from "@/auth";
import { numberAttr, stringAttr, type ProductView } from "@/domain/catalog/types";
import { deliveryDate, workingDaysUntil } from "@/domain/delivery/delivery";
import {
  energyCost10yCents,
  energyPriceFromEnv,
  ENERGY_SUBCATEGORIES,
  tcoCents,
} from "@/domain/energy/energy";
import { priceLine } from "@/domain/pricing/omnibus";
import { bestOffer, eligibleOffers } from "@/domain/ranking/filters";
import { formatCm, formatDateDative, formatEur } from "@/i18n/format";
import { Button } from "@/ui/Button";
import { InfoBox, Kicker, Lead, Page, PageTitle, Panel, Screen, SectionTitle } from "@/ui/layout";
import { cardMedia } from "../rezultati/card-media";
import { CardRow, ResultCard, type CardModel } from "../rezultati/ResultCard";
import { factLines } from "../rezultati/confidence-text";
import { reviewSummary } from "@/domain/confidence/confidence";
import { NOINDEX, pageMetadata } from "../seo";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  const t = await getTranslations();
  const meta = pageMetadata("/modelis", t("model.title"), t("meta.modelDescription"));
  // Every search would be its own URL: only the empty form is indexed.
  return q ? { ...meta, robots: NOINDEX } : meta;
}

/** Accepts a shop URL and reduces it to the last path segment, else returns the text. */
function queryFromInput(raw: string): string {
  const text = raw.trim().slice(0, 200);
  try {
    const u = new URL(text);
    const seg = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return seg.replace(/[-_]+/g, " ").replace(/\.html?$/, "");
  } catch {
    return text;
  }
}

function sizeClassOf(p: ProductView): string | null {
  return stringAttr(p, "size_class") ?? stringAttr(p, "type");
}

function dims(p: ProductView): string | null {
  const parts = [numberAttr(p, "height_cm"), numberAttr(p, "width_cm"), numberAttr(p, "depth_cm")];
  if (parts.every((x) => x === null)) return null;
  return parts.map((x) => (x === null ? "—" : formatCm(x))).join(" × ");
}

/** Spec §4: model-check flow. */
export default async function ModelPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const t = await getTranslations("model");
  const tr = await getTranslations("results");
  const query = q ? queryFromInput(q) : "";
  const energyPrice = energyPriceFromEnv();
  const now = new Date();

  let chosen: ProductView | null = null;
  let alternatives: { product: ProductView; priceCents: number; tco: number | null }[] = [];
  if (query) {
    const found = await searchProducts(db, query, 1);
    chosen = found[0] ?? null;
    if (chosen) {
      const best = bestOffer(eligibleOffers(chosen, "new", "no_rush"));
      if (best) {
        const pool = await loadCandidates(db, chosen.subcategoryId);
        const cls = sizeClassOf(chosen);
        alternatives = pool
          .filter((p) => p.id !== chosen!.id && (cls === null || sizeClassOf(p) === cls))
          .map((p) => ({ product: p, offer: bestOffer(eligibleOffers(p, "new", "no_rush")) }))
          .filter((x): x is { product: ProductView; offer: NonNullable<typeof x.offer> } => !!x.offer)
          .filter((x) => Math.abs(x.offer.priceCents - best.priceCents) <= best.priceCents * 0.12)
          .map((x) => ({
            product: x.product,
            priceCents: x.offer.priceCents,
            tco: tcoCents(x.offer.priceCents, x.product.kwhYear, energyPrice) ?? x.offer.priceCents,
          }))
          .sort((a, b) => (a.tco ?? 0) - (b.tco ?? 0))
          .slice(0, 2);
      }
    }
  }

  const saved = await savedKeys(
    db,
    await currentUserId(),
    [chosen, ...alternatives.map((a) => a.product)].flatMap((p) => (p ? [productKey(p.id)] : [])),
  );

  function card(p: ProductView, label: "yourChoice" | "betterValue" | "alternative"): CardModel | null {
    const best = bestOffer(eligibleOffers(p, "new", "no_rush"));
    if (!best) return null;
    const date = deliveryDate(best, now, "LV");
    const cost = ENERGY_SUBCATEGORIES.has(p.subcategoryId)
      ? energyCost10yCents(p.kwhYear, energyPrice)
      : null;
    const total = cost !== null ? tcoCents(best.priceCents, p.kwhYear, energyPrice) : null;
    const d = dims(p);
    return {
      productId: p.id,
      name: cleanName(p.name, p.brand, p.modelCode),
      modelCode: p.modelCode,
      ean: p.ean,
      specs: [p.specs, d ? t("dimensions", { dims: d }) : null].filter(Boolean).join(" · ") || null,
      tier: null,
      recommended: label === "betterValue",
      roles: [],
      roleIds: [],
      verdict: null,
      catchText: null,
      priceNote: null,
      facts: factLines(p, reviewSummary(p), (k, v) => tr(k as "title", v as Record<string, string>)),
      best: {
        id: best.id,
        storeName: best.storeName,
        priceCents: best.priceCents,
        stock: best.stock === "soon" ? "soon" : "in",
        deliveryDate: date ? formatDateDative(date) : null,
        deliveryDays: workingDaysUntil(best),
      },
      overBudgetByCents: 0,
      priceLine: priceLine(best.priceCents, best.lowest30dCents),
      whyFits: total !== null ? [t("tco", { amount: formatEur(total) })] : [],
      unconfirmed: [],
      unknownData: null,
      energy: cost !== null && total !== null ? { cost10yCents: cost, totalCents: total } : null,
      otherOffers: p.offers
        .filter((o) => o.condition === "new" && o.stock !== "out" && o.id !== best.id)
        .map((o) => ({ storeName: o.storeName, priceCents: o.priceCents })),
      savingVsMaxCents: null,
      upgrade: null,
      refurbished: null,
      sessionId: null,
      saved: saved.has(productKey(p.id)),
      ...cardMedia(p),
    };
  }

  const refurb = chosen ? bestOffer(eligibleOffers(chosen, "refurbished", "no_rush")) : null;
  const chosenCard = chosen ? card(chosen, "yourChoice") : null;
  const altCards = alternatives
    .map((a, i) =>
      card(
        a.product,
        i === 0 && chosenCard && (a.tco ?? 0) < (chosenCard.energy?.totalCents ?? chosenCard.best.priceCents)
          ? "betterValue"
          : "alternative",
      ),
    )
    .filter((c): c is CardModel => !!c);

  const form = (
    <form method="get" className="flex max-w-[560px] flex-wrap items-end gap-[14px]">
      <label htmlFor="model-q" className="sr-only">
        {t("label")}
      </label>
      <input
        id="model-q"
        name="q"
        defaultValue={q ?? ""}
        required
        maxLength={200}
        enterKeyHint="search"
        placeholder={t("placeholder")}
        autoFocus={!query}
        className="min-w-0 flex-[1_1_260px] border-0 border-b-2 border-lime bg-transparent py-2 font-heading text-[clamp(20px,3vw,28px)] font-semibold text-mist outline-none placeholder:text-stone/60"
      />
      <Button type="submit">{t("submit")}</Button>
    </form>
  );

  if (!query) {
    return (
      <Screen>
        <Kicker>{t("kicker")}</Kicker>
        <PageTitle>{t("title")}</PageTitle>
        <Lead>{t("hint")}</Lead>
        <div className="mt-1.5">{form}</div>
      </Screen>
    );
  }

  return (
    <Page size="wide" gap="gap-[22px]">
      <div className="flex flex-col gap-[10px]">
        <Kicker>{t("kicker")}</Kicker>
        <PageTitle>{t("title")}</PageTitle>
        {form}
      </div>

      {!chosenCard ? (
        <div role="status">
          <Panel tone="dashed" className="text-lg">
            {t("notFound")}
          </Panel>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3" aria-labelledby="your-choice">
            <SectionTitle id="your-choice">{t("yourChoice")}</SectionTitle>
            <CardRow>
              <ResultCard card={chosenCard} />
              <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-2 self-start sm:max-w-[560px]">
                <InfoBox>
                  <p className="font-semibold">{t("fitTitle")}</p>
                  <p className="mt-1 text-[15px] text-panel-text">{t("fitHint")}</p>
                </InfoBox>
              </aside>
            </CardRow>
          </section>
          {altCards.length ? (
            <section className="flex flex-col gap-3" aria-labelledby="alternatives">
              <SectionTitle id="alternatives">{t("alternatives")}</SectionTitle>
              <p className="max-w-[760px] text-base text-stone">{t("lead")}</p>
              <CardRow>
                {altCards.map((c) => (
                  <ResultCard key={c.productId} card={c} />
                ))}
              </CardRow>
            </section>
          ) : null}
          {refurb && chosen ? (
            <section aria-labelledby="model-refurb-title">
              <h2 id="model-refurb-title" className="sr-only">
                {t("refurbished")}
              </h2>
              <ResultCard
                card={{
                  ...chosenCard,
                  recommended: false,
                  best: {
                    ...chosenCard.best,
                    id: refurb.id,
                    storeName: refurb.storeName,
                    priceCents: refurb.priceCents,
                    stock: refurb.stock === "soon" ? "soon" : "in",
                  },
                  priceLine: priceLine(refurb.priceCents, refurb.lowest30dCents),
                  otherOffers: [],
                  energy: null,
                  whyFits: [],
                  refurbished: {
                    grade: refurb.grade,
                    warrantyMonths: refurb.warrantyMonths,
                    savingVsNewCents: Math.max(0, chosenCard.best.priceCents - refurb.priceCents),
                  },
                }}
              />
            </section>
          ) : null}
        </>
      )}
    </Page>
  );
}
