// Rule 5 (EU Omnibus): any discount claim references the lowest price of
// the previous 30 days. Snapshots come from price_snapshots (one per offer
// per ingestion run). The current price is excluded from the window so
// "lowest in 30 days" compares against history, not itself.

export type Snapshot = { priceCents: number; capturedAt: Date };

export const WINDOW_DAYS = 30;

/** Lowest historical price within the window, or null when there is no history yet. */
export function lowest30d(snapshots: Snapshot[], now: Date, currentPriceCents?: number): number | null {
  const since = now.getTime() - WINDOW_DAYS * 86_400_000;
  let min: number | null = null;
  for (const s of snapshots) {
    const t = s.capturedAt.getTime();
    if (t < since || t > now.getTime()) continue;
    if (min === null || s.priceCents < min) min = s.priceCents;
  }
  // A single snapshot equal to the current price is not "history".
  if (min !== null && currentPriceCents !== undefined && min === currentPriceCents) {
    const others = snapshots.filter(
      (s) => s.capturedAt.getTime() >= since && s.priceCents !== currentPriceCents,
    );
    if (others.length === 0) return null;
  }
  return min;
}

export type PriceLine =
  { kind: "no_history" } | { kind: "lowest_now" } | { kind: "was_lower"; lowestCents: number };

/** Which 30-day line the card shows (spec §3.2). */
export function priceLine(currentPriceCents: number, lowest30dCents: number | null): PriceLine {
  if (lowest30dCents === null) return { kind: "no_history" };
  if (currentPriceCents <= lowest30dCents) return { kind: "lowest_now" };
  return { kind: "was_lower", lowestCents: lowest30dCents };
}

/**
 * A discount claim is allowed only against the 30-day low, and only when the
 * current price is below it. Returns the percentage (rounded down) or null.
 */
export function discountPercent(currentPriceCents: number, lowest30dCents: number | null): number | null {
  if (lowest30dCents === null || lowest30dCents <= 0 || currentPriceCents >= lowest30dCents) return null;
  return Math.floor(((lowest30dCents - currentPriceCents) / lowest30dCents) * 100);
}
