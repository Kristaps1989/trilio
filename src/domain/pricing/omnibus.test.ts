import { describe, expect, it } from "vitest";
import { discountPercent, lowest30d, priceLine } from "./omnibus";

const now = new Date("2026-10-17T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("lowest30d", () => {
  it("takes the minimum inside the window and ignores older snapshots", () => {
    const snaps = [
      { priceCents: 69900, capturedAt: daysAgo(40) }, // outside
      { priceCents: 64900, capturedAt: daysAgo(20) },
      { priceCents: 67900, capturedAt: daysAgo(5) },
    ];
    expect(lowest30d(snaps, now)).toBe(64900);
  });
  it("returns null with no history, and when the only history is today's price", () => {
    expect(lowest30d([], now)).toBeNull();
    expect(lowest30d([{ priceCents: 69900, capturedAt: daysAgo(0) }], now, 69900)).toBeNull();
    expect(
      lowest30d(
        [
          { priceCents: 69900, capturedAt: daysAgo(0) },
          { priceCents: 71900, capturedAt: daysAgo(3) },
        ],
        now,
        69900,
      ),
    ).toBe(69900);
  });
  it("ignores snapshots from the future", () => {
    expect(lowest30d([{ priceCents: 10000, capturedAt: new Date(now.getTime() + 1000) }], now)).toBeNull();
  });
});

describe("priceLine and discountPercent", () => {
  it("picks the right 30-day line", () => {
    expect(priceLine(64900, null)).toEqual({ kind: "no_history" });
    expect(priceLine(64900, 64900)).toEqual({ kind: "lowest_now" });
    expect(priceLine(62900, 64900)).toEqual({ kind: "lowest_now" });
    expect(priceLine(69900, 64900)).toEqual({ kind: "was_lower", lowestCents: 64900 });
  });
  it("only claims a discount against the 30-day low (Omnibus)", () => {
    expect(discountPercent(59900, 69900)).toBe(14);
    expect(discountPercent(69900, 69900)).toBeNull();
    expect(discountPercent(69900, 64900)).toBeNull();
    expect(discountPercent(59900, null)).toBeNull();
  });
});
