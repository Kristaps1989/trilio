import { describe, expect, it } from "vitest";
import { savedCents, savingsProof } from "./proof";

describe("savings proof", () => {
  it("is what the frozen shop price was above Trilio's, times the quantity", () => {
    expect(savedCents({ referencePriceCents: 54900, priceCents: 49900, quantity: 1 })).toBe(5000);
    expect(savedCents({ referencePriceCents: 10000, priceCents: 9000, quantity: 2 })).toBe(2000);
    expect(savedCents({ referencePriceCents: 9000, priceCents: 9900, quantity: 1 })).toBe(0);
    expect(savedCents({ referencePriceCents: null, priceCents: 9900, quantity: 1 })).toBeNull();
  });

  it("counts savings of at least 1 €, in whole euros, the latest first", () => {
    const p = savingsProof([
      { subcategoryId: "fridge", savedCents: 5099, paidAt: new Date("2026-11-02T10:00:00Z") },
      { subcategoryId: "kettle", savedCents: 99, paidAt: new Date("2026-11-05T10:00:00Z") },
      { subcategoryId: "washer", savedCents: 3000, paidAt: new Date("2026-10-20T10:00:00Z") },
    ])!;
    expect(p.count).toBe(2);
    expect(p.totalCents).toBe(8000);
    expect(p.latest).toEqual({
      subcategoryId: "fridge",
      savedCents: 5000,
      paidAt: new Date("2026-11-02T10:00:00Z"),
    });
  });

  it("is nothing without a saving", () => {
    expect(savingsProof([])).toBeNull();
    expect(savingsProof([{ subcategoryId: "fridge", savedCents: 0, paidAt: new Date() }])).toBeNull();
  });
});
