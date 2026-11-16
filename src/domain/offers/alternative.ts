import { goodness, minLead, targetIn, type Target } from "@/domain/confidence/confidence";
import { sameBrand } from "@/domain/ranking/score";

// Offering another maker's product when the one asked for is unavailable
// (docs/ALTERNATIVE_OFFER_PLAN.md). Pure rules: how the two compare, which
// word the e-mail may use for that ("līdzvērtīgs" only when nothing is worse),
// the price checks that block sending, when Trilio suggests "nothing to
// offer", and each request's outcome as the admin lists show it.

// ---------------------------------------------------------------- comparison

/**
 * better / same / worse on an attribute with a better way; different when one without
 * (installation, type) differs; unknown when the alternative does not state it; neutral
 * when only the alternative states it (nothing to compare with, and no downside).
 */
export type Verdict = "better" | "same" | "worse" | "different" | "unknown" | "neutral";

export type ComparedLine = {
  attr: string;
  original: unknown;
  alternative: unknown;
  verdict: Verdict;
};

/** "equivalent" (līdzvērtīgs) only when no compared line is worse, different or unknown; otherwise "similar" (līdzīgs). */
export type AlternativeLabel = "equivalent" | "similar";

export type Comparison = { lines: ComparedLine[]; label: AlternativeLabel };

type Attrs = Record<string, unknown>;

const isBlank = (v: unknown) => v === undefined || v === null || v === "";

function directional(t: Target, o: Attrs, a: Attrs): Verdict {
  const view = (attributes: Attrs) => ({ attributes }) as Parameters<typeof goodness>[0];
  const go = goodness(view(o), t);
  const ga = goodness(view(a), t);
  if (ga === null) return "unknown";
  if (go === null) return "neutral";
  const diff = ga - go;
  if (Math.abs(diff) < minLead(t)) return "same";
  return diff > 0 ? "better" : "worse";
}

/**
 * The two products side by side on the category's compare attributes, in order.
 * A line neither product states is left out. A value only the original states is
 * "unknown" (missing data never counts as "tāpat").
 */
export function compareProducts(
  original: Attrs,
  alternative: Attrs,
  keys: string[],
  subcategoryId: string,
): Comparison {
  const lines: ComparedLine[] = [];
  for (const attr of [...new Set(keys)]) {
    const ov = original[attr];
    const av = alternative[attr];
    if (isBlank(ov) && isBlank(av)) continue;
    const t = targetIn(attr, subcategoryId);
    let verdict: Verdict;
    if (isBlank(av)) verdict = "unknown";
    else if (t) verdict = directional(t, original, alternative);
    else if (isBlank(ov)) verdict = "neutral";
    else verdict = String(ov) === String(av) ? "same" : "different";
    lines.push({ attr, original: ov ?? null, alternative: av ?? null, verdict });
  }
  const label: AlternativeLabel =
    lines.length > 0 &&
    lines.every((l) => l.verdict === "better" || l.verdict === "same" || l.verdict === "neutral") &&
    lines.some((l) => l.verdict !== "neutral")
      ? "equivalent"
      : "similar";
  return { lines, label };
}

/** The lines the e-mail must name as downsides: worse, different or not stated. */
export function downsides(c: Comparison): ComparedLine[] {
  return c.lines.filter((l) => l.verdict === "worse" || l.verdict === "different" || l.verdict === "unknown");
}

// ---------------------------------------------------------------- price

export type PriceProblem = "not_below_shop" | "above_original";

/**
 * Both are hard rules (owner, 16 Nov 2026): the offer must beat the alternative's own
 * lowest shop price, or there is no reason to buy from Trilio; and it may not cost more
 * than the original's price the shopper saw. A product with no shop price (not in the
 * catalogue) skips the first check; an unknown original price skips the second.
 */
export function alternativePriceProblems(p: {
  offerCents: number;
  alternativeShopCents: number | null;
  originalSeenCents: number | null;
}): PriceProblem[] {
  const out: PriceProblem[] = [];
  if (p.alternativeShopCents !== null && p.offerCents >= p.alternativeShopCents) out.push("not_below_shop");
  if (p.originalSeenCents !== null && p.offerCents > p.originalSeenCents) out.push("above_original");
  return out;
}

// ---------------------------------------------------------------- suggestions

export type SuggestionInput = {
  id: string;
  brand: string;
  /** In stock at a partner shop now: the lowest price, or null when no shop has it. */
  shopCents: number | null;
  /** The normal ranking value (higher is better), never the margin. */
  value: number;
};

/** Up to `max` products from other makers that a shop has now, in ranking order. */
export function pickSuggestions(
  candidates: SuggestionInput[],
  original: { id: string; brand: string },
  max = 5,
): SuggestionInput[] {
  return candidates
    .filter((c) => c.id !== original.id && !sameBrand(c.brand, original.brand) && c.shopCents !== null)
    .sort((a, b) => b.value - a.value || a.shopCents! - b.shopCents! || a.id.localeCompare(b.id))
    .slice(0, max);
}

// ---------------------------------------------------------------- nothing to offer

export type NothingReason = "partner_not_cheaper" | "no_alternative" | "all_partners_refused" | "other";
export const NOTHING_REASONS: readonly NothingReason[] = [
  "partner_not_cheaper",
  "no_alternative",
  "all_partners_refused",
  "other",
];

/** The default minimum margin above the partner's cost (Admin → Sistēma). */
export const DEFAULT_MIN_MARGIN_PCT = 3;

export type NothingFacts = {
  /** The newest partner answer for the product. */
  partner: { status: "requested" | "confirmed" | "unavailable"; costCents: number | null } | null;
  /** Every partner asked, by their newest answer (the partner_requests history). */
  partnersAsked: { status: "requested" | "confirmed" | "unavailable" }[];
  bestShopCents: number | null;
  minMarginPct: number;
  /** Whether any suggested alternative passes the comparison and has a confirmed partner. */
  alternativeAvailable: boolean;
};

/**
 * Trilio's suggestion that there is nothing to offer, with its reason, or null.
 * Only a suggestion: the admin confirms (no time limits, owner 30 Oct 2026).
 */
export function suggestNothing(f: NothingFacts): Exclude<NothingReason, "other"> | null {
  const p = f.partner;
  if (p?.status === "confirmed" && p.costCents !== null && f.bestShopCents !== null) {
    const floor = Math.ceil(p.costCents * (1 + f.minMarginPct / 100));
    if (floor >= f.bestShopCents) return "partner_not_cheaper";
  }
  if (p?.status === "unavailable") {
    const asked = f.partnersAsked;
    if (asked.length > 1 && asked.every((a) => a.status === "unavailable")) return "all_partners_refused";
    if (!f.alternativeAvailable) return "no_alternative";
  }
  return null;
}

// ---------------------------------------------------------------- outcomes

export type StoredOutcome =
  "alternative_offered" | "alternative_asked" | "nothing_to_offer" | "monitoring_only";

/** The chip on each request (§2), in the order a request moves through them. */
export type RequestChip =
  | "new"
  | "requested"
  | "offered"
  | "alternative_offered"
  | "alternative_asked"
  | "nothing_to_offer"
  | "monitoring_only"
  | "ended";

export type RequestFacts = {
  /** Agreed to Trilio's offers (the request's text covered them, or the account opted in). */
  wantsOffers: boolean;
  /** Worth asking a partner at this price (src/domain/offers/sourcing.ts). */
  worthAsking: boolean;
  /** An offer for the same product went out to this person (not cancelled). */
  offered: boolean;
  /** The newest outcome recorded for this person and product. */
  outcome: StoredOutcome | null;
  /** The partner state of the product. */
  partner: "requested" | "confirmed" | "unavailable" | null;
  /** Price monitoring ended (90 days, unsubscribed). */
  ended: boolean;
};

export function requestChip(f: RequestFacts): RequestChip {
  if (f.ended) return "ended";
  if (f.offered) return "offered";
  if (f.outcome) return f.outcome;
  if (!f.wantsOffers || !f.worthAsking) return "monitoring_only";
  return f.partner === "requested" ? "requested" : "new";
}

/** Whether this request still waits for Trilio's answer. */
export function undecided(chip: RequestChip): boolean {
  return chip === "new" || chip === "requested";
}

/**
 * From this consent version on, the request form says that Trilio may offer one
 * equivalent product from another maker when the one asked for is unavailable.
 * Everyone else is asked first (owner, 16 Nov 2026).
 */
export const ALTERNATIVE_CONSENT_FROM = "2026-11-16";

export function mayOfferAlternativeDirectly(consentVersion: string | null): boolean {
  return !!consentVersion && consentVersion >= ALTERNATIVE_CONSENT_FROM;
}

// ---------------------------------------------------------------- the admin's description

export type DescriptionIssue = "urgency" | "superlative" | "shouting" | "equivalent_claim" | "too_long";
export const DESCRIPTION_MAX = 1500;

/**
 * "Trilio apraksts" follows the honesty rules (CLAUDE.md rule 4): no fake urgency or
 * scarcity, no superlatives Trilio can't show, no shouting, and no "līdzvērtīgs" when
 * the comparison only allows "līdzīgs".
 */
export function descriptionIssues(text: string, label: AlternativeLabel | null): DescriptionIssue[] {
  const t = text.trim();
  const out = new Set<DescriptionIssue>();
  if (t.length > DESCRIPTION_MAX) out.add("too_long");
  if (
    /\b(tikai|vien)\s+(šodien|sodien|rīt)\b|p[eē]d[eē]j(ā|a|ie|ais)\b|steidz|pasteidz|nenokav|atlik(uši|ušas)\s+tikai|\bonly\s+today\b|\blast\s+(one|chance|few)\b|\bhurry\b/i.test(
      t,
    )
  )
    out.add("urgency");
  if (
    /\b(nr\.?\s*1|numur(s|a)\s*1|#1|labākais\s+(latvij|tirg)|lētākais\s+(latvij|tirg)|best\s+in\s+latvia|cheapest)\b/i.test(
      t,
    )
  )
    out.add("superlative");
  if (/!{2,}|\b[A-ZĀČĒĢĪĶĻŅŠŪŽ]{6,}\b/.test(t)) out.add("shouting");
  if (label === "similar" && /līdzvērtīg|equivalent/i.test(t)) out.add("equivalent_claim");
  return [...out];
}

/** What the admin typed for a product no shop lists: numbers as numbers, "jā/ir" and "nē/nav" as yes and no. */
export function parseTypedAttributes(entries: [string, string][]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of entries) {
    const v = raw.trim();
    if (!v) continue;
    const n = v.replace(/\s/g, "").replace(",", ".");
    if (/^-?\d+(\.\d+)?$/.test(n)) out[key] = Number(n);
    else if (/^(jā|ja|ir|yes|true)$/i.test(v)) out[key] = true;
    else if (/^(nē|ne|nav|no|false)$/i.test(v)) out[key] = false;
    else out[key] = v;
  }
  return out;
}
