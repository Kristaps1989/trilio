// Spec §3.2: "Elektrība 10 gados ~480 € · kopā ar pirkumu ~1 079 €".
// Energy price is configuration (default 25 ct/kWh); kWh/year comes from
// EPREL or the feed. All money in integer cents.

export const DEFAULT_ENERGY_PRICE_CENTS_PER_KWH = 25;
export const ENERGY_YEARS = 10;

/** Subcategories where the 10-year electricity line is shown (spec §3.2). */
export const ENERGY_SUBCATEGORIES = new Set(["fridge", "freezer", "washer", "dryer", "dish"]);

export function energyPriceFromEnv(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.ENERGY_PRICE_CENTS_PER_KWH ?? DEFAULT_ENERGY_PRICE_CENTS_PER_KWH);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ENERGY_PRICE_CENTS_PER_KWH;
}

/** 10-year electricity cost in cents, rounded to whole euros×10 like the prototype (480 €, not 482,50 €). */
export function energyCost10yCents(kwhYear: number | null, priceCentsPerKwh: number): number | null {
  if (kwhYear === null || kwhYear <= 0) return null;
  const cents = kwhYear * priceCentsPerKwh * ENERGY_YEARS;
  return Math.round(cents / 1000) * 1000;
}

/** Total cost of ownership: purchase + 10-year electricity. Null when energy is unknown. */
export function tcoCents(
  priceCents: number,
  kwhYear: number | null,
  priceCentsPerKwh: number,
): number | null {
  const energy = energyCost10yCents(kwhYear, priceCentsPerKwh);
  return energy === null ? null : priceCents + energy;
}
