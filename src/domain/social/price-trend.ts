import { formatEur } from "@/i18n/format";

// What a product's price did in the last 30 days at the shop the post names (owner, 28 Nov 2026:
// Reels about products, their analysis and price changes). Pure. The words follow the Omnibus
// rule (CLAUDE.md rule 5): a price is called lower only against the shop's own lowest price of
// the 30 days before today, and a price above that low says so instead of staying silent.

export type PricePoint = { day: string; priceCents: number };

export type PriceTrend = {
  /**
   * below: under the 30-day low; lowest: at it; steady: the same price all 30 days;
   * above: the shop had it cheaper in the 30 days.
   */
  status: "below" | "lowest" | "steady" | "above";
  /** The days the line is drawn from, oldest first, today's price last. */
  points: PricePoint[];
  lowCents: number;
  highCents: number;
  /** The lowest price before today (the Omnibus reference). */
  priorLowCents: number;
  label: string;
};

/** Fewer days than this is not a trend: the slide shows the specs instead of a line. */
export const MIN_TREND_DAYS = 7;

const eur = (cents: number) => formatEur(cents, "lv");

/**
 * The trend of one offer: `history` is its price per day (any order, a day at most once), `today`
 * the day as YYYY-MM-DD and `todayCents` the price the post shows. Null without enough days.
 */
export function priceTrend(history: PricePoint[], todayCents: number, today: string): PriceTrend | null {
  const prior = history
    .filter((p) => p.day < today && Number.isFinite(p.priceCents) && p.priceCents > 0)
    .sort((a, b) => a.day.localeCompare(b.day));
  if (prior.length + 1 < MIN_TREND_DAYS) return null;
  const points = [...prior, { day: today, priceCents: todayCents }];
  const prices = points.map((p) => p.priceCents);
  const lowCents = Math.min(...prices);
  const highCents = Math.max(...prices);
  const priorLowCents = Math.min(...prior.map((p) => p.priceCents));
  let status: PriceTrend["status"];
  let label: string;
  if (highCents === lowCents) {
    status = "steady";
    label = "Cena 30 dienās nav mainījusies";
  } else if (todayCents < priorLowCents) {
    status = "below";
    label = `−${eur(priorLowCents - todayCents)} zem 30 dienu zemākās`;
  } else if (todayCents === priorLowCents) {
    status = "lowest";
    label = "Zemākā cena 30 dienās";
  } else {
    status = "above";
    label = `30 dienās bija arī ${eur(priorLowCents)}`;
  }
  return { status, points, lowCents, highCents, priorLowCents, label };
}
