import { loadCandidates } from "@/db/queries/catalog";
import type { Db } from "@/db/client";
import type { OfferComparison } from "@/db/schema";
import { enumLabels, formatAttr } from "@/app/[locale]/rezultati/attr-format";
import type { ProductView } from "@/domain/catalog/types";
import {
  compareProducts,
  downsides,
  pickSuggestions,
  type Comparison,
  type ComparedLine,
} from "@/domain/offers/alternative";
import { byValue, candidatePool } from "@/domain/ranking/rank";
import { getSubcategory } from "@/domain/questions/catalog";
import { currentOffer } from "@/domain/wishlist/wishlist";
import en from "@/i18n/messages/en.json";
import lv from "@/i18n/messages/lv.json";
import type { UiLocale } from "@/i18n/routing";
import type { CompareRow } from "./mail-layout";
import { answerCopyFor, fill } from "./texts";

// Another maker's product for a request whose product is unavailable
// (docs/ALTERNATIVE_OFFER_PLAN.md §3.3): Trilio's suggestions in ranking order
// (never by margin), the side-by-side comparison, and that comparison in the
// reader's words for the e-mail and the offer page.

/** The attributes compared: the category's compare rows (data/categories.json). */
export function comparedKeys(subcategoryId: string): string[] {
  return getSubcategory(subcategoryId)?.compare ?? [];
}

export function compare(
  original: ProductView,
  alternative: { attributes: Record<string, unknown> },
): Comparison {
  return compareProducts(
    original.attributes,
    alternative.attributes,
    comparedKeys(original.subcategoryId),
    original.subcategoryId,
  );
}

export type Suggestion = {
  product: ProductView;
  shopCents: number;
  storeName: string;
  comparison: Comparison;
};

/**
 * Up to five products from the same subcategory and other makers that a partner
 * shop has now, best value first by the normal ranking (src/domain/ranking): those
 * not dearer in the shops than 1.3 × the original first, so they stay in its class,
 * then others when fewer than three are.
 */
export async function suggestionsFor(
  db: Db,
  original: ProductView,
  originalCents: number | null,
): Promise<Suggestion[]> {
  const sub = getSubcategory(original.subcategoryId);
  if (!sub) return [];
  const products = await loadCandidates(db, sub.id);
  const ordered = byValue(
    candidatePool({ products, sub, answers: {}, budget: null, urgency: "two_weeks", showUnknown: true }),
  );
  const cap = originalCents ? Math.round(originalCents * 1.3) : null;
  const all = ordered.map((c, i) => ({
    id: c.product.id,
    brand: c.product.brand,
    shopCents: c.price,
    value: ordered.length - i,
  }));
  const near = pickSuggestions(
    all.filter((c) => cap === null || c.shopCents <= cap),
    { id: original.id, brand: original.brand },
  );
  // Few in its class: the rest by the same order, dearer ones included (the price checks still apply).
  const picked =
    near.length >= 3
      ? near
      : [
          ...near,
          ...pickSuggestions(all, { id: original.id, brand: original.brand }, 10).filter(
            (s) => !near.some((n) => n.id === s.id),
          ),
        ].slice(0, 5);
  const byId = new Map(ordered.map((c) => [c.product.id, c]));
  return picked.map((s) => {
    const c = byId.get(s.id)!;
    return {
      product: c.product,
      shopCents: c.price,
      storeName: c.offer.storeName,
      comparison: compare(original, c.product),
    };
  });
}

/** The lowest shop price now, or null. */
export function shopPrice(p: ProductView): { cents: number; store: string } | null {
  const o = currentOffer(p);
  return o ? { cents: o.priceCents, store: o.storeName } : null;
}

// ---------------------------------------------------------------- words

type Attr = Record<string, string>;
const attrCopy = (lang: UiLocale): Attr => (lang === "en" ? en.attr : lv.attr) as Attr;

export function attrLabel(key: string, lang: UiLocale): string {
  return attrCopy(lang)[key] ?? key;
}

/** The comparison in the reader's language: one row per line, and the downsides named. */
export function comparisonWords(
  c: Pick<OfferComparison, "label" | "lines">,
  subcategoryId: string,
  lang: UiLocale,
): { rows: CompareRow[]; downsides: string[] } {
  const sub = getSubcategory(subcategoryId, lang);
  const enums = sub ? enumLabels(sub) : {};
  const ta = (k: string) => attrCopy(lang)[k] ?? k;
  const a = answerCopyFor(lang);
  const value = (line: ComparedLine, v: unknown) => formatAttr(line.attr, v, ta, enums);
  const tone = { better: "good", same: "same", worse: "bad", different: "bad", unknown: "none" } as const;
  const rows: CompareRow[] = c.lines.map((l) => ({
    label: attrLabel(l.attr, lang),
    asked: value(l, l.original),
    offered: value(l, l.alternative),
    // Only what differs is marked ("Tāpat" left out), so the eye goes to the differences.
    verdict:
      l.verdict === "neutral" || l.verdict === "same"
        ? null
        : { text: a.verdict[l.verdict], tone: tone[l.verdict] },
  }));
  const down = downsides({ label: c.label, lines: c.lines }).map((l) =>
    fill(l.verdict === "worse" ? a.downWorse : l.verdict === "different" ? a.downDifferent : a.downUnknown, {
      attr: attrLabel(l.attr, lang).toLowerCase(),
    }),
  );
  return { rows, downsides: c.label === "equivalent" ? [] : down };
}
