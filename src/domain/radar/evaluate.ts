import type { ProductView } from "@/domain/catalog/types";
import type { Answers, Subcategory } from "@/domain/questions/schema";
import { bestOffer, eligibleOffers, passesHardFilters } from "@/domain/ranking/filters";
import { tcoCents } from "@/domain/energy/energy";

// Radar evaluator (docs/DATA_MODEL.md): after each ingestion, for every
// active radar decide whether to notify. Pure: the job feeds it products
// and the radar's settings; it returns events. Debounce (one notification
// per product per day) is enforced here through `lastNotifiedAt`.

export type RadarSettings = {
  id: string;
  productId: string;
  threshold: "any" | "5" | "10";
  scope: "only" | "brand" | "any";
  storeIds: string[];
  includeRefurbished: boolean;
  baselinePriceCents: number | null;
  lastNotifiedAt: Date | null;
  paused: boolean;
  /** Saved requirements from the search session; null when tracking from the model-check flow. */
  answers: Answers | null;
};

export type RadarEvent =
  | { kind: "drop"; productId: string; offerId: string; oldPriceCents: number; newPriceCents: number }
  | { kind: "similar"; productId: string; offerId: string; oldPriceCents: number; newPriceCents: number };

export const DEBOUNCE_MS = 24 * 3600 * 1000;

function thresholdMet(threshold: RadarSettings["threshold"], oldCents: number, newCents: number): boolean {
  if (newCents >= oldCents) return false;
  const dropPct = ((oldCents - newCents) / oldCents) * 100;
  return threshold === "any" ? true : dropPct >= Number(threshold);
}

/** Best eligible offer honouring the store filter and the new/refurbished choice. */
export function trackedOffer(
  product: ProductView,
  radar: Pick<RadarSettings, "storeIds" | "includeRefurbished">,
) {
  const pool = product.offers.filter(
    (o) => radar.storeIds.length === 0 || radar.storeIds.includes(o.storeId),
  );
  const asProduct = { ...product, offers: pool };
  const candidates = [...eligibleOffers(asProduct, "new", "two_weeks")];
  if (radar.includeRefurbished) candidates.push(...eligibleOffers(asProduct, "refurbished", "two_weeks"));
  return bestOffer(candidates);
}

export function evaluateRadar(
  radar: RadarSettings,
  tracked: ProductView,
  comparables: { products: ProductView[]; sub: Subcategory | null; energyPriceCentsPerKwh: number },
  now = new Date(),
): RadarEvent[] {
  if (radar.paused) return [];
  if (radar.lastNotifiedAt && now.getTime() - radar.lastNotifiedAt.getTime() < DEBOUNCE_MS) return [];
  const events: RadarEvent[] = [];

  const best = trackedOffer(tracked, radar);
  const baseline = radar.baselinePriceCents;
  if (best && baseline !== null && thresholdMet(radar.threshold, baseline, best.priceCents)) {
    events.push({
      kind: "drop",
      productId: tracked.id,
      offerId: best.id,
      oldPriceCents: baseline,
      newPriceCents: best.priceCents,
    });
  }

  // Comparable models (spec §5.1 step 2): same requirements, same size class, same hard filters,
  // meaningfully better price or TCO than the tracked product's current best.
  if (radar.scope !== "only" && best && comparables.sub) {
    const trackedTco =
      tcoCents(best.priceCents, tracked.kwhYear, comparables.energyPriceCentsPerKwh) ?? best.priceCents;
    // The product form (data/attributes.json) is the size class; older rows carry size_class/type.
    const formOf = (p: ProductView) =>
      p.attributes.form ?? p.attributes.size_class ?? p.attributes.type ?? null;
    const sizeClass = formOf(tracked);
    for (const p of comparables.products) {
      if (p.id === tracked.id || p.subcategoryId !== tracked.subcategoryId) continue;
      if (radar.scope === "brand" && p.brand.toLowerCase() !== tracked.brand.toLowerCase()) continue;
      if (sizeClass !== null && formOf(p) !== sizeClass) continue;
      if (radar.answers) {
        // A suggestion must provably meet the saved requirements: missing fit data is not a match.
        const v = passesHardFilters(p, comparables.sub, radar.answers);
        if (!v.pass || v.fitUnknown) continue;
      }
      const offer = trackedOffer(p, radar);
      if (!offer) continue;
      const tco =
        tcoCents(offer.priceCents, p.kwhYear, comparables.energyPriceCentsPerKwh) ?? offer.priceCents;
      // "Meaningfully better": at least 5 % lower TCO and a lower price.
      if (offer.priceCents < best.priceCents && tco <= trackedTco * 0.95) {
        events.push({
          kind: "similar",
          productId: p.id,
          offerId: offer.id,
          oldPriceCents: best.priceCents,
          newPriceCents: offer.priceCents,
        });
      }
    }
    events.splice(3); // never more than a handful per run
  }
  return events;
}
