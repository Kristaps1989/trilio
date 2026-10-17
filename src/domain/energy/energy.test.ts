import { describe, expect, it } from "vitest";
import { energyCost10yCents, energyPriceFromEnv, tcoCents } from "./energy";

describe("energy", () => {
  it("10-year cost at 0,25 €/kWh, rounded to 10 €", () => {
    // 249 kWh × 0,25 € × 10 = 622,50 € → 620 €
    expect(energyCost10yCents(249, 25)).toBe(62000);
    // 192 kWh → 480 €
    expect(energyCost10yCents(192, 25)).toBe(48000);
    expect(energyCost10yCents(null, 25)).toBeNull();
    expect(energyCost10yCents(0, 25)).toBeNull();
  });
  it("TCO adds purchase price", () => {
    expect(tcoCents(59900, 192, 25)).toBe(107900); // 599 + 480 = 1 079 €
    expect(tcoCents(59900, null, 25)).toBeNull();
  });
  it("reads the price from env with a safe default", () => {
    expect(energyPriceFromEnv({})).toBe(25);
    expect(energyPriceFromEnv({ ENERGY_PRICE_CENTS_PER_KWH: "30" })).toBe(30);
    expect(energyPriceFromEnv({ ENERGY_PRICE_CENTS_PER_KWH: "abc" })).toBe(25);
  });
});
