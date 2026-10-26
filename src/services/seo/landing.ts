import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loadCandidates } from "@/db/queries/catalog";
import type { ProductView } from "@/domain/catalog/types";
import { argumentTargets, assignRoles } from "@/domain/confidence/confidence";
import { decidingAttrs } from "@/domain/knowledge/knowledge";
import type { Subcategory } from "@/domain/questions/schema";
import { bestOffer, eligibleOffers, withinBudget } from "@/domain/ranking/filters";
import { candidatePool, mainstreamCeilingCents, rank } from "@/domain/ranking/rank";
import { decideLanding, type LandingDecision } from "@/domain/seo/landing-index";

// Category landing pages: "Labākie ledusskapji līdz 800 €" (docs/SEO_INDEXING_PLAN.md).
// The same ranking as the guided flow with no answers (stock and budget only),
// and the decision which of a category's pages keep their own address in search.

export async function landingCards(
  db: Db,
  sub: Subcategory,
  budgetCents: number | null,
  loaded?: ProductView[],
) {
  const products = loaded ?? (await loadCandidates(db, sub.id));
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
  const input = {
    products,
    sub,
    answers: {},
    budget: budgetCents ?? ceilingCents,
    urgency: "two_weeks" as const,
  };
  const result = rank({ ...input, includeRefurbished: false });
  // The same earned roles as the results page (docs/CONFIDENCE_PLAN.md A2).
  const pool = candidatePool(input).filter((c) => withinBudget(c.price, input.budget));
  const decides = decidingAttrs(sub.id);
  const target = argumentTargets(sub, {}, decides)[0] ?? null;
  const roles = assignRoles(
    result.picks.map((p) => ({ ...p, price: p.offer.priceCents })),
    pool,
    sub,
    target,
    decides,
  );
  return { result, products, ceilingCents, roles, target, fits: pool.length };
}

export type LandingIndex = {
  decision: LandingDecision;
  /** When the page's picks last changed price, ISO; null when unknown. Key "base" or the budget step. */
  lastChanged: Record<string, string | null>;
};

/** The latest price change (or first sighting) per offer, from the price history. */
async function lastPriceChange(db: Db, offerIds: string[]): Promise<Map<string, Date>> {
  if (offerIds.length === 0) return new Map();
  const rows = (await db.execute(sql`
    select offer_id, max(captured_at) as changed from (
      select offer_id, captured_at, price_cents,
        lag(price_cents) over (partition by offer_id order by captured_at) as prev
      from price_snapshots
      where offer_id in (${sql.join(
        offerIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    ) t
    where prev is null or prev <> price_cents
    group by offer_id`)) as unknown as { offer_id: string; changed: string | Date }[];
  return new Map(rows.map((r) => [r.offer_id, new Date(r.changed)]));
}

/** Which of a category's landing pages keep their own address, and when each last changed. */
export async function landingIndex(db: Db, sub: Subcategory): Promise<LandingIndex> {
  const products = await loadCandidates(db, sub.id);
  const base = await landingCards(db, sub, null, products);
  const steps = await Promise.all(
    sub.budget_steps_eur.map(async (eur) => ({
      eur,
      picks: (await landingCards(db, sub, eur * 100, products)).result.picks,
    })),
  );
  const decision = decideLanding({
    base: base.result.picks.map((p) => p.product.id),
    steps: steps.map((s) => ({ eur: s.eur, ids: s.picks.map((p) => p.product.id) })),
  });
  const pages: [string, typeof base.result.picks][] = [
    ["base", base.result.picks],
    ...steps.map((s) => [String(s.eur), s.picks] as [string, typeof base.result.picks]),
  ];
  const changes = await lastPriceChange(db, [
    ...new Set(pages.flatMap(([, picks]) => picks.map((p) => p.offer.id))),
  ]);
  const lastChanged: Record<string, string | null> = {};
  for (const [k, picks] of pages) {
    const times = picks.flatMap((p) => {
      const d = changes.get(p.offer.id);
      return d ? [d.getTime()] : [];
    });
    lastChanged[k] = times.length ? new Date(Math.max(...times)).toISOString() : null;
  }
  return { decision, lastChanged };
}
