import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { loadCandidates, searchProducts } from "@/db/queries/catalog";
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
import { PrimaryButton } from "@/ui/PrimaryButton";
import { Shell } from "@/ui/Shell";
import { ResultCard, type CardModel } from "../rezultati/ResultCard";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("model");
  return { title: t("title") };
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
      name: p.name,
      modelCode: p.modelCode,
      ean: p.ean,
      specs: [p.specs, d ? t("dimensions", { dims: d }) : null].filter(Boolean).join(" · ") || null,
      tier: null,
      recommended: label === "betterValue",
      rating: p.rating,
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
      energy: cost !== null && total !== null ? { cost10yCents: cost, totalCents: total } : null,
      otherOffers: p.offers
        .filter((o) => o.condition === "new" && o.stock !== "out" && o.id !== best.id)
        .map((o) => ({ storeName: o.storeName, priceCents: o.priceCents })),
      savingVsMaxCents: null,
      upgrade: null,
      refurbished: null,
      sessionId: null,
      trackHref: `/radars/jauns?product=${p.id}`,
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

  return (
    <Shell>
      <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">{t("title")}</h1>
      <p className="mt-2 text-base text-stone">{t("hint")}</p>
      <form method="get" className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-base font-semibold text-mist">
          <span>{t("label")}</span>
          <input
            name="q"
            defaultValue={q ?? ""}
            required
            maxLength={200}
            enterKeyHint="search"
            className="min-h-14 w-full rounded-[14px] border-[1.5px] border-mist-32 bg-white-5 px-4 text-[17px] text-mist"
          />
        </label>
        <PrimaryButton type="submit">{t("submit")}</PrimaryButton>
      </form>

      {query && !chosenCard ? (
        <p className="mt-6 text-base text-mist" role="status">
          {t("notFound")}
        </p>
      ) : null}

      {chosenCard ? (
        <div className="mt-6 flex flex-col gap-6">
          <section className="flex flex-col gap-3" aria-label={t("yourChoice")}>
            <h2 className="text-xl font-bold text-mist">{t("yourChoice")}</h2>
            <ResultCard card={chosenCard} />
            <div className="rounded-[14px] border border-mist-32 bg-white-5 p-4 text-sm text-stone">
              <p className="font-semibold text-mist">{t("fitTitle")}</p>
              <p className="mt-1">{t("fitHint")}</p>
            </div>
          </section>
          {altCards.length ? (
            <section className="flex flex-col gap-3" aria-label={t("alternative")}>
              <p className="text-sm text-stone">{t("lead")}</p>
              {altCards.map((c) => (
                <div key={c.productId} className="flex flex-col gap-2">
                  <h2 className="text-lg font-bold text-mist">
                    {c.recommended ? t("betterValue") : t("alternative")}
                  </h2>
                  <ResultCard card={c} />
                </div>
              ))}
            </section>
          ) : null}
          {refurb && chosen ? (
            <section aria-label="refurbished">
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
        </div>
      ) : null}
    </Shell>
  );
}
