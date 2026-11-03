import { describe, expect, it } from "vitest";
import { OFFER_DISCOUNT_UP_TO_PCT, maxOfferSavingCents } from "./discount";

describe("maxOfferSavingCents", () => {
  it("takes the set percentage of the shop price", () => {
    expect(OFFER_DISCOUNT_UP_TO_PCT).toBe(10);
    expect(maxOfferSavingCents(3400)).toBe(340);
    expect(maxOfferSavingCents(59900)).toBe(5990);
  });

  it("rounds down, never claiming more than the percentage", () => {
    expect(maxOfferSavingCents(1999)).toBe(199);
    expect(maxOfferSavingCents(1999, 20)).toBe(399);
  });

  it("is zero for no price or no discount", () => {
    expect(maxOfferSavingCents(0)).toBe(0);
    expect(maxOfferSavingCents(-100)).toBe(0);
    expect(maxOfferSavingCents(Number.NaN)).toBe(0);
    expect(maxOfferSavingCents(3400, 0)).toBe(0);
  });
});
