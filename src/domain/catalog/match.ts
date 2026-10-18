import type { MatchCond } from "@/domain/questions/schema";
import type { ProductView } from "./types";

// Evaluates answer conditions (categories.json option.match) against a
// product's attributes. Three-valued: true, false, or null when the product
// does not state the attribute, so callers can tell "contradicts the answer"
// from "we do not know" (docs/FILTERS_PLAN.md §2.2).

export type Tri = true | false | null;

export function condHolds(attributes: Record<string, unknown>, c: MatchCond): Tri {
  const v = attributes[c.attr];
  if (v === undefined || v === null || v === "") return null;
  if (c.eq !== undefined && v !== c.eq) return false;
  if (c.in !== undefined && !c.in.includes(String(v))) return false;
  if (c.lte !== undefined || c.gte !== undefined) {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (c.lte !== undefined && v > c.lte) return false;
    if (c.gte !== undefined && v < c.gte) return false;
  }
  return true;
}

/** All conditions: false if any is false, null if none is false but one is unknown, else true. */
export function matchAll(p: Pick<ProductView, "attributes">, conds: MatchCond[]): Tri {
  let unknown = false;
  for (const c of conds) {
    const r = condHolds(p.attributes, c);
    if (r === false) return false;
    if (r === null) unknown = true;
  }
  return unknown ? null : true;
}

/** Unknown attribute names among the conditions (for "nav zināms: …" lines). */
export function unknownAttrs(p: Pick<ProductView, "attributes">, conds: MatchCond[]): string[] {
  return conds.filter((c) => condHolds(p.attributes, c) === null).map((c) => c.attr);
}
