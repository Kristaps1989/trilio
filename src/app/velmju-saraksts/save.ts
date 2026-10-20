import "server-only";
import { db } from "@/db";
import { loadCandidates, loadProduct } from "@/db/queries/catalog";
import { saveProduct, saveSearch } from "@/db/queries/wishlist";
import { decodeState, encodeState } from "@/domain/flow/state";
import { getSubcategory } from "@/domain/questions/catalog";
import { currentOffer, productKey, searchKey, searchProposal } from "@/domain/wishlist/wishlist";

// What a heart saves. The baseline (the price a drop is measured against) is
// today's price: the product's best offer, or the search's recommended pick.

export type SaveTarget =
  | { kind: "product"; productId: string }
  | { kind: "search"; subcategoryId: string; answersParam: string; label: string };

export function keyOf(target: SaveTarget): string {
  return target.kind === "product"
    ? productKey(target.productId)
    : searchKey(target.subcategoryId, target.answersParam);
}

export async function saveTarget(userId: string, target: SaveTarget): Promise<boolean> {
  if (target.kind === "product") {
    const product = await loadProduct(db, target.productId);
    if (!product) return false;
    await saveProduct(db, userId, {
      productId: product.id,
      subcategoryId: product.subcategoryId,
      baselinePriceCents: currentOffer(product)?.priceCents ?? null,
    });
    return true;
  }
  const sub = getSubcategory(target.subcategoryId);
  if (!sub) return false;
  // Normalise the answers through the flow's own decoder so equal searches share one key.
  const state = decodeState(sub, target.answersParam);
  const answersParam = encodeState(state);
  const top = searchProposal(await loadCandidates(db, sub.id), sub, state).top;
  await saveSearch(db, userId, {
    subcategoryId: sub.id,
    answersParam,
    label: target.label,
    baselinePriceCents: top?.offer.priceCents ?? null,
  });
  return true;
}
