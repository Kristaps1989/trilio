import type { Db } from "@/db/client";
import { loadProduct } from "@/db/queries/catalog";
import { priceHistory } from "@/db/queries/wishlist";
import type { ProductView } from "@/domain/catalog/types";
import { currentOffer } from "@/domain/wishlist/wishlist";

// What the monitored shops charge for a product right now and over the last
// 30 days: the facts an offer is measured against (rule 5).

export type ProductReference = {
  product: ProductView;
  priceCents: number | null;
  storeName: string | null;
  low30Cents: number | null;
};

export async function referenceFor(db: Db, productId: string): Promise<ProductReference | null> {
  const product = await loadProduct(db, productId);
  if (!product) return null;
  const best = currentOffer(product);
  const history = await priceHistory(db, productId, 30);
  const lows = history.map((h) => h.priceCents);
  if (best) lows.push(best.priceCents);
  return {
    product,
    priceCents: best?.priceCents ?? null,
    storeName: best?.storeName ?? null,
    low30Cents: lows.length ? Math.min(...lows) : null,
  };
}
