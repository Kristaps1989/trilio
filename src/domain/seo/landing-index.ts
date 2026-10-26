// Which category landing pages earn their own address in search (docs/SEO_INDEXING_PLAN.md §2A).
// Google left budget pages out of its index when they showed the same three
// products as the base page or a lower budget. Such a page keeps rendering,
// but its canonical points to the page it repeats and it leaves the sitemap.

export type LandingPicks = {
  /** Product ids on the base page, in any order. */
  base: string[];
  /** Product ids per budget step (euros), in any order. */
  steps: { eur: number; ids: string[] }[];
};

// The base page always keeps its address, also with nothing in stock: an empty
// catalogue (a feed outage, a fresh database) must never take the category pages
// out of search. Only budget pages fold.

export type LandingDecision = {
  /**
   * Per budget step: null when the page is distinct (its own canonical), else
   * the budget step it folds into, or 0 for the base page.
   */
  canonicalOf: Record<number, number | null>;
};

/** Picks needed for a budget page of its own; fewer is a thinner copy of the base page. */
export const DISTINCT_MIN_PICKS = 3;

const key = (ids: string[]) => [...ids].sort().join("|");

export function decideLanding({ base, steps }: LandingPicks): LandingDecision {
  const canonicalOf: Record<number, number | null> = {};
  // Pages so far that keep their own address: the base page (0) and distinct budget steps.
  const seen = new Map<string, number>([[key(base), 0]]);
  let lastDistinct = 0;
  for (const step of [...steps].sort((a, b) => a.eur - b.eur)) {
    const k = key(step.ids);
    const repeats = seen.get(k);
    if (step.ids.length >= DISTINCT_MIN_PICKS && repeats === undefined) {
      canonicalOf[step.eur] = null;
      seen.set(k, step.eur);
      lastDistinct = step.eur;
    } else {
      // The page it repeats, or the nearest page below that keeps its own address.
      canonicalOf[step.eur] = repeats ?? lastDistinct;
    }
  }
  return { canonicalOf };
}

/** The address a landing page names as canonical: its own, or the page it repeats. */
export function landingCanonicalPath(
  subId: string,
  eur: number | null,
  decision: LandingDecision | null,
): string {
  const target = eur === null || !decision ? eur : (decision.canonicalOf[eur] ?? eur);
  return target ? `/kategorija/${subId}/lidz-${target}` : `/kategorija/${subId}`;
}
