import type { OfferView, ProductView } from "@/domain/catalog/types";

// Test builders for domain tests: plain products and offers with defaults.

let seq = 0;

export function offer(o: Partial<OfferView> = {}): OfferView {
  return {
    id: `o${++seq}`,
    storeId: "s1",
    storeName: "Veikals A",
    condition: "new",
    grade: null,
    warrantyMonths: null,
    priceCents: 50000,
    stock: "in",
    deliveryEtaDays: null,
    storeDefaultDeliveryDays: 3,
    url: "https://example.invalid/o",
    lowest30dCents: null,
    ...o,
  };
}

/** A product; `price` is shorthand for one in-stock new offer at that many euros. */
export function product(
  p: Partial<ProductView> & { name: string; price?: number; attrs?: Record<string, unknown> },
): ProductView {
  const { price, attrs, ...rest } = p;
  return {
    id: p.name,
    ean: null,
    brand: p.name.split(" ")[0]!,
    modelCode: p.name,
    subcategoryId: "fridge",
    attributes: attrs ?? {},
    tags: [],
    specs: null,
    kwhYear: (attrs?.kwh_year as number | undefined) ?? null,
    rating: 80,
    imageUrl: null,
    extractionConfidence: null,
    offers: [offer(price !== undefined ? { priceCents: price * 100 } : {})],
    ...rest,
  };
}
