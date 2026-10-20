import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { loadCandidates, loadProducts } from "@/db/queries/catalog";
import { itemsForEvaluation, markNotified, setBaseline } from "@/db/queries/wishlist";
import type { ProductView } from "@/domain/catalog/types";
import { decodeState } from "@/domain/flow/state";
import { getSubcategory } from "@/domain/questions/catalog";
import { currentOffer, evaluateItem, searchProposal, type WishlistEvent } from "@/domain/wishlist/wishlist";
import { formatEur } from "@/i18n/format";
import { currentSubscription, hasAccess } from "@/services/billing/engine";
import { createEmailSender, type EmailSender } from "@/services/notify/email";

// Runs after each ingestion: for every user with the paid e-mail service,
// one digest of the saved items whose price dropped enough (each item at
// most once a day), then the dropped price becomes the new baseline.

export type WishlistTexts = {
  subjectOne: (v: { name: string; price: string }) => string;
  subjectMany: (v: { count: number }) => string;
  productLine: (v: { name: string; price: string; shop: string; old: string }) => string;
  searchLine: (v: { label: string; name: string; price: string; shop: string; old: string }) => string;
  view: string;
};

export type WishlistJobResult = { evaluated: number; emailed: number; skippedNoAccess: number };

type Current = {
  productId: string;
  product: ProductView;
  offer: NonNullable<ReturnType<typeof currentOffer>>;
};

export async function runWishlistJob(
  db: Db,
  opts: { email?: EmailSender; baseUrl: string; texts: WishlistTexts; now?: Date },
): Promise<WishlistJobResult> {
  const now = opts.now ?? new Date();
  const email = opts.email ?? createEmailSender();
  const result: WishlistJobResult = { evaluated: 0, emailed: 0, skippedNoAccess: 0 };

  const rows = await itemsForEvaluation(db);
  if (rows.length === 0) return result;
  const productIds = [...new Set(rows.flatMap((r) => (r.item.productId ? [r.item.productId] : [])))];
  const byId = new Map((await loadProducts(db, productIds)).map((p) => [p.id, p]));
  const bySub = new Map<string, ProductView[]>();
  const access = new Map<string, boolean>();
  const events = new Map<string, { event: WishlistEvent; current: Current; label: string | null }[]>();

  for (const { item, threshold } of rows) {
    if (!access.has(item.userId)) {
      access.set(item.userId, hasAccess(await currentSubscription(db, item.userId), now));
    }
    let current: Current | null = null;
    if (item.kind === "product" && item.productId) {
      const product = byId.get(item.productId);
      const offer = product ? currentOffer(product) : null;
      current = product && offer ? { productId: product.id, product, offer } : null;
    } else if (item.kind === "search") {
      const sub = getSubcategory(item.subcategoryId);
      if (sub) {
        if (!bySub.has(sub.id)) bySub.set(sub.id, await loadCandidates(db, sub.id));
        const top = searchProposal(bySub.get(sub.id)!, sub, decodeState(sub, item.answersParam)).top;
        current = top ? { productId: top.product.id, product: top.product, offer: top.offer } : null;
      }
    }
    // An item saved while out of stock starts measuring from its first price.
    if (item.baselinePriceCents === null && current) {
      await setBaseline(db, item.id, current.offer.priceCents);
      continue;
    }
    if (!access.get(item.userId)) {
      result.skippedNoAccess++;
      continue;
    }
    result.evaluated++;
    const event = evaluateItem(item, current, threshold ?? "5", now);
    if (!event || !current) continue;
    events.set(item.userId, [...(events.get(item.userId) ?? []), { event, current, label: item.label }]);
  }

  for (const [userId, list] of events) {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    if (!user) continue;
    const lines = list.map(({ event, current, label }) => {
      const v = {
        name: current.product.name,
        price: formatEur(event.newPriceCents),
        shop: current.offer.storeName,
        old: formatEur(event.oldPriceCents),
      };
      return event.kind === "search" && label
        ? opts.texts.searchLine({ ...v, label })
        : opts.texts.productLine(v);
    });
    const first = list[0]!;
    const subject =
      list.length === 1
        ? opts.texts.subjectOne({
            name: first.current.product.name,
            price: formatEur(first.event.newPriceCents),
          })
        : opts.texts.subjectMany({ count: list.length });
    const sent = await email.send({
      to: user.email,
      subject,
      text: `${lines.join("\n")}\n\n${opts.texts.view}: ${opts.baseUrl}/velmju-saraksts`,
    });
    if (!sent.ok) continue;
    for (const { event } of list) await markNotified(db, event.itemId, event.newPriceCents, now);
    result.emailed++;
  }
  return result;
}
