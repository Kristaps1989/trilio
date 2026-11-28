import { describe, expect, it } from "vitest";
import { MIN_TREND_DAYS, priceTrend, type PricePoint } from "./price-trend";

// A Reel's price line (owner, 28 Nov 2026): what the shop's price did in 30 days, and words that
// follow the Omnibus rule: "lower" only against the shop's own lowest price before today.

const days = (prices: number[]): PricePoint[] =>
  prices.map((priceCents, i) => ({ day: `2026-11-${String(10 + i).padStart(2, "0")}`, priceCents }));
const TODAY = "2026-11-28";

describe("priceTrend", () => {
  it("says how far today's price is under the 30-day low, never against a higher price", () => {
    const t = priceTrend(days([39999, 39999, 37999, 37999, 36999, 36999, 36999]), 34999, TODAY)!;
    expect(t.status).toBe("below");
    expect(t.priorLowCents).toBe(36999);
    // Under the lowest of the 30 days (369,99 €), not under the 399,99 € it once was.
    expect(t.label).toBe("−20 € zem 30 dienu zemākās");
    expect(t.points.at(-1)).toEqual({ day: TODAY, priceCents: 34999 });
    expect([t.lowCents, t.highCents]).toEqual([34999, 39999]);
  });

  it("at the low, steady, or above the low: each said plainly", () => {
    expect(priceTrend(days([5000, 5000, 4500, 4500, 4800, 4800]), 4500, TODAY)).toMatchObject({
      status: "lowest",
      label: "Zemākā cena 30 dienās",
    });
    expect(priceTrend(days([4999, 4999, 4999, 4999, 4999, 4999]), 4999, TODAY)).toMatchObject({
      status: "steady",
      label: "Cena 30 dienās nav mainījusies",
    });
    // The shop had it cheaper: the post says so rather than hiding it.
    expect(priceTrend(days([13900, 15900, 13900, 15900, 15900, 15900]), 14900, TODAY)).toMatchObject({
      status: "above",
      label: "30 dienās bija arī 139 €",
    });
  });

  it("draws no line from too few days, and ignores today's own snapshot as the reference", () => {
    expect(priceTrend(days([5000, 5000, 5000]), 4000, TODAY)).toBeNull();
    expect(MIN_TREND_DAYS).toBe(7);
    const withToday = [...days([5000, 5000, 5000, 5000, 5000, 5000]), { day: TODAY, priceCents: 4000 }];
    expect(priceTrend(withToday, 4000, TODAY)).toMatchObject({ status: "below", priorLowCents: 5000 });
    expect(priceTrend(withToday, 4000, TODAY)!.points).toHaveLength(7);
  });
});
