// Plain data the domain modules work on. The DB layer maps rows to these;
// nothing here imports Drizzle, React or Next.

export type Condition = "new" | "refurbished";
export type Stock = "in" | "soon" | "out";
export type Urgency = "asap" | "two_weeks" | "no_rush";

export type OfferView = {
  id: string;
  storeId: string;
  /** Display name from the stores table (rule 7: never hard-coded). */
  storeName: string;
  condition: Condition;
  grade: string | null;
  warrantyMonths: number | null;
  priceCents: number;
  stock: Stock;
  /** Shop's own ETA in working days when the feed has one. */
  deliveryEtaDays: number | null;
  /** Store default when the feed has none. */
  storeDefaultDeliveryDays: number;
  url: string;
  /** Lowest price of this offer in the previous 30 days, excluding the current price (Omnibus). */
  lowest30dCents: number | null;
};

export type ProductView = {
  id: string;
  ean: string | null;
  brand: string;
  modelCode: string;
  name: string;
  subcategoryId: string;
  attributes: Record<string, unknown>;
  tags: string[];
  specs: string | null;
  kwhYear: number | null;
  /** 0–100; 86 renders as "8,6/10". */
  rating: number | null;
  imageUrl: string | null;
  /** Null when attributes came from the feed or no extraction ran; < 60 means "nav apstiprināts". */
  extractionConfidence: number | null;
  offers: OfferView[];
};

export function numberAttr(p: ProductView, key: string): number | null {
  const v = p.attributes[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function stringAttr(p: ProductView, key: string): string | null {
  const v = p.attributes[key];
  return typeof v === "string" && v ? v : null;
}

export function boolAttr(p: ProductView, key: string): boolean | null {
  const v = p.attributes[key];
  return typeof v === "boolean" ? v : null;
}
