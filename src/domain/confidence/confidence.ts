import type { ProductView } from "@/domain/catalog/types";
import { numberAttr } from "@/domain/catalog/types";
import { numberRule } from "@/domain/delta/delta";
import { energyCost10yCents } from "@/domain/energy/energy";
import { activeOptions } from "@/domain/questions/engine";
import type { Answers, Question, Subcategory } from "@/domain/questions/schema";
import { brandTable, gradeOf, ungradedSubcategory, type BrandTable } from "@/domain/ranking/consider";
import {
  bestOffer,
  eligibleOffers,
  passesHardFilters,
  questionAttrs,
  type PriceBounds,
} from "@/domain/ranking/filters";
import { betterDirection, FEATURES } from "@/domain/ranking/quality";
import { byValue, type Candidate } from "@/domain/ranking/rank";
import type { Urgency } from "@/domain/catalog/types";

// Three options a shopper can trust (docs/CONFIDENCE_PLAN.md): why each pick
// is there (its role), one verdict in the shopper's terms, its catch against
// the best available, what was considered and rejected, the shops' reviews
// and how settled the price is. Every function is deterministic and only
// states what the data says; the UI turns the structured output into text.

const ENERGY_ORDER = ["A", "B", "C", "D", "E", "F", "G"];

// ---------------------------------------------------------------- targets

/** What "better" means for one attribute: a number to minimise or maximise, a feature, or the energy class. */
export type Target = { attr: string; kind: "min" | "max" | "bool" | "energy" };

export function targetOf(attr: string): Target | null {
  if (attr === "energy_class") return { attr, kind: "energy" };
  if (FEATURES.has(attr)) return { attr, kind: "bool" };
  const dir = betterDirection(attr);
  return dir ? { attr, kind: dir } : null;
}

/** Higher is better; null when the product does not state it. */
export function goodness(p: ProductView, t: Target): number | null {
  const v = p.attributes[t.attr];
  if (v === undefined || v === null || v === "") return null;
  switch (t.kind) {
    case "energy": {
      const i = ENERGY_ORDER.indexOf(String(v));
      return i < 0 ? null : -i;
    }
    case "bool":
      return typeof v === "boolean" ? (v ? 1 : 0) : null;
    case "min":
      return typeof v === "number" ? -v : null;
    case "max":
      return typeof v === "number" ? v : null;
  }
}

/** The smallest difference worth calling a lead (2 dB, 10 L, one energy class, having the feature). */
export function minLead(t: Target): number {
  if (t.kind === "energy" || t.kind === "bool") return 1;
  return numberRule(t.attr)?.minDelta ?? 0.0001;
}

/** The shopper's first priority as a target, with the option that chose it. */
export function priorityTarget(
  sub: Subcategory,
  answers: Answers,
): { target: Target; questionId: string; optionValue: string; label: string } | null {
  const q = sub.questions.find((x) => x.id === "priorities");
  if (!q) return null;
  for (const o of activeOptions(q, answers)) {
    const cond = o.match?.[0];
    if (!cond) continue;
    const target = cond.eq === true ? { attr: cond.attr, kind: "bool" as const } : targetOf(cond.attr);
    if (target) return { target, questionId: q.id, optionValue: o.value, label: o.label };
  }
  return null;
}

/** The targets the page argues about: the shopper's priority first, then the category's deciding attributes. */
export function argumentTargets(sub: Subcategory, answers: Answers, decides: string[]): Target[] {
  const out: Target[] = [];
  const add = (t: Target | null) => {
    if (t && !out.some((x) => x.attr === t.attr)) out.push(t);
  };
  add(priorityTarget(sub, answers)?.target ?? null);
  for (const a of decides) add(targetOf(a));
  return out;
}

// ---------------------------------------------------------------- roles

export type Role = "sensible" | "priority" | "cheapest_good" | "lasting";
export const ROLE_ORDER: Role[] = ["sensible", "priority", "lasting", "cheapest_good"];

const known = (p: ProductView, key: string) => {
  const v = p.attributes[key];
  return v !== undefined && v !== null && v !== "";
};

/**
 * The cheapest product we would buy ourselves (§3 A2): fit data known, a
 * brand graded 3 or better (or, without a grade, every deciding attribute
 * known), and no deciding attribute among the worst quarter of the pool.
 */
export function passesQualityFloor(
  c: Candidate,
  pool: Candidate[],
  sub: Subcategory,
  decides: string[],
  table: BrandTable = brandTable,
): boolean {
  if (c.fitUnknown) return false;
  const graded = table.reviewed && !ungradedSubcategory(table, sub.id);
  const grade = graded ? gradeOf(table, c.product.brand, sub.id) : null;
  if (grade !== null && grade < 3) return false;
  if (grade === null && graded && !decides.every((a) => known(c.product, a))) return false;
  for (const attr of decides) {
    const t = targetOf(attr);
    if (!t) continue;
    const mine = goodness(c.product, t);
    if (mine === null) continue;
    const values = pool.map((x) => goodness(x.product, t)).filter((v): v is number => v !== null);
    if (values.length < 4 || new Set(values).size < 2) continue;
    const worse = values.filter((v) => v < mine).length;
    const better = values.filter((v) => v > mine).length;
    // Strictly in the bottom quarter: three quarters of the pool are better.
    if (better / values.length > 0.75 && worse === 0) return false;
  }
  return true;
}

/** Leads the other picks on the target by at least the attribute's meaningful step, and is the best in budget. */
function leadsOn(pick: Candidate, picks: Candidate[], pool: Candidate[], t: Target): boolean {
  const mine = goodness(pick.product, t);
  if (mine === null) return false;
  const best = Math.max(...pool.map((c) => goodness(c.product, t) ?? -Infinity));
  if (mine < best) return false;
  const others = picks.filter((p) => p !== pick).map((p) => goodness(p.product, t));
  const step = minLead(t);
  if (others.length === 0) {
    const values = pool.map((c) => goodness(c.product, t)).filter((v): v is number => v !== null);
    return values.some((v) => mine - v >= step);
  }
  // Every other pick is known to be worse by the step; an unknown one cannot be beaten honestly.
  return others.every((v) => v !== null && mine - v >= step);
}

/**
 * Why each pick is on the page (§3 A2). A role is earned against the whole
 * in-budget pool, never assumed from price position. A pick can hold several
 * roles; a pick may hold none (the page then says only its verdict).
 */
export function assignRoles(
  picks: Candidate[],
  pool: Candidate[],
  sub: Subcategory,
  target: Target | null,
  decides: string[],
  table: BrandTable = brandTable,
): Map<string, Role[]> {
  const roles = new Map<string, Role[]>(picks.map((p) => [p.product.id, []]));
  if (picks.length === 0 || pool.length === 0) return roles;
  const give = (c: Candidate | undefined, r: Role) => {
    if (c && roles.has(c.product.id)) roles.get(c.product.id)!.push(r);
  };

  const sensible = byValue(pool)[0];
  if (sensible && picks.some((p) => p.product.id === sensible.product.id)) give(sensible, "sensible");

  if (target) {
    const leader = picks.find((p) => leadsOn(p, picks, pool, target));
    give(leader, "priority");
  }

  const graded = table.reviewed && !ungradedSubcategory(table, sub.id);
  if (graded) {
    const grades = pool.map((c) => gradeOf(table, c.product.brand, sub.id) ?? 0);
    const top = Math.max(...grades);
    if (top >= 4) {
      const best = pool
        .filter((_, i) => grades[i] === top)
        .sort(
          (a, b) =>
            (numberAttr(b.product, "warranty_months") ?? 0) -
              (numberAttr(a.product, "warranty_months") ?? 0) ||
            (numberAttr(b.product, "model_year") ?? 0) - (numberAttr(a.product, "model_year") ?? 0) ||
            b.score - a.score ||
            a.price - b.price,
        )[0];
      // Only when some pick is graded lower, so the role says something.
      const lower = picks.some((p) => (gradeOf(table, p.product.brand, sub.id) ?? 0) < top);
      if (best && lower && best.product.id !== sensible?.product.id) give(best, "lasting");
    }
  }

  const cheapest = [...pool]
    .sort((a, b) => a.price - b.price)
    .find((c) => passesQualityFloor(c, pool, sub, decides, table));
  // Only when it is the cheapest pick: "the cheapest we would buy" on a dearer card would not be true.
  const cheapestPick = [...picks].sort((a, b) => a.price - b.price)[0];
  if (cheapest && cheapestPick && cheapest.product.id === cheapestPick.product.id)
    give(cheapest, "cheapest_good");

  for (const [id, list] of roles)
    roles.set(
      id,
      ROLE_ORDER.filter((r) => list.includes(r)),
    );
  return roles;
}

// ---------------------------------------------------------------- reviews

export type ReviewSummary = { x10: number; count: number; shops: number };

/** At least this many shop reviews in total before a star line is shown (§3 B1). */
export const MIN_REVIEWS = 10;

/** The shops' review scores for a product, weighted by their counts; null with fewer than 10 reviews. */
export function reviewSummary(p: ProductView): ReviewSummary | null {
  let weight = 0;
  let sum = 0;
  let shops = 0;
  for (const o of p.offers) {
    if (o.condition !== "new" || !o.ratingX10 || !o.ratingCount) continue;
    weight += o.ratingCount;
    sum += o.ratingX10 * o.ratingCount;
    shops++;
  }
  if (weight < MIN_REVIEWS) return null;
  return { x10: Math.round(sum / weight), count: weight, shops };
}

// ---------------------------------------------------------------- verdict

export type VerdictPart =
  /** "Četriem cilvēkiem 300 L ir īstais izmērs": a flow answer the product meets, with its own value. */
  | { kind: "answer_fit"; questionId: string; answer: string; attr: string; value: number }
  /** Best of the picks (and the best available in budget) on an attribute. */
  | { kind: "leads"; attr: string; value: unknown; ofPool: boolean }
  /** A brand graded 4 or 5 for this category. */
  | { kind: "reliable"; brand: string; grade: number }
  /** Dearer than the cheapest pick, cheaper over ten years. */
  | { kind: "tco"; extraCents: number; savedCents: number }
  /** The cheapest pick that passes the quality floor. */
  | { kind: "cheapest_sound" }
  /** Well reviewed in the shops (4,5 ★ and up). */
  | { kind: "reviews"; x10: number; count: number }
  /** Nothing to say with confidence: names what the shop does not state. */
  | { kind: "thin"; attrs: string[] }
  /** Fallback: the best quality for its price among the matching products. */
  | { kind: "value"; matching: number };

export type VerdictContext = {
  sub: Subcategory;
  answers: Answers;
  picks: Candidate[];
  pool: Candidate[];
  targets: Target[];
  decides: string[];
  roles: Role[];
  energyPriceCentsPerKwh: number;
  answerPhrases: Record<string, unknown>;
  table?: BrandTable;
};

/** One or two claims about a pick, strongest first, each backed by its data (§3 A3). Never empty. */
export function verdictFor(pick: Candidate, ctx: VerdictContext): VerdictPart[] {
  const table = ctx.table ?? brandTable;
  const parts: VerdictPart[] = [];
  const push = (p: VerdictPart) => {
    if (parts.length < 2) parts.push(p);
  };

  // 1. The shopper's own answer, in their words, with the product's number.
  for (const q of ctx.sub.questions) {
    if (!ctx.answerPhrases[q.id]) continue;
    const o = activeOptions(q, ctx.answers)[0];
    const cond = o?.match?.find((m) => m.gte !== undefined || m.lte !== undefined);
    if (!o || !cond) continue;
    const value = numberAttr(pick.product, cond.attr);
    if (value === null) continue;
    if ((cond.gte !== undefined && value < cond.gte) || (cond.lte !== undefined && value > cond.lte))
      continue;
    push({ kind: "answer_fit", questionId: q.id, answer: o.label, attr: cond.attr, value });
    break;
  }

  // 2. Leads on what matters most: the priority, then the deciding attributes.
  for (const t of ctx.targets) {
    if (parts.some((p) => p.kind === "leads")) break;
    if (!leadsOn(pick, ctx.picks, ctx.pool, t)) continue;
    const best = Math.max(...ctx.pool.map((c) => goodness(c.product, t) ?? -Infinity));
    push({
      kind: "leads",
      attr: t.attr,
      value: pick.product.attributes[t.attr],
      ofPool: goodness(pick.product, t) === best && ctx.pool.length > ctx.picks.length,
    });
  }

  // 3. Reliability, stated positively, when the evidence is strong.
  const graded = table.reviewed && !ungradedSubcategory(table, ctx.sub.id);
  const grade = graded ? gradeOf(table, pick.product.brand, ctx.sub.id) : null;
  if (grade !== null && grade >= 4) push({ kind: "reliable", brand: pick.product.brand, grade });

  // 4. Cost of ownership against the cheapest pick.
  const cheapest = [...ctx.picks].sort((a, b) => a.price - b.price)[0];
  if (cheapest && cheapest !== pick && pick.price > cheapest.price) {
    const mine = energyCost10yCents(pick.product.kwhYear, ctx.energyPriceCentsPerKwh);
    const theirs = energyCost10yCents(cheapest.product.kwhYear, ctx.energyPriceCentsPerKwh);
    if (mine !== null && theirs !== null) {
      const extra = pick.price - cheapest.price;
      const saved = theirs - mine;
      if (saved > extra) push({ kind: "tco", extraCents: extra, savedCents: saved });
    }
  }

  if (ctx.roles.includes("cheapest_good")) push({ kind: "cheapest_sound" });

  const reviews = reviewSummary(pick.product);
  if (reviews && reviews.x10 >= 45) push({ kind: "reviews", x10: reviews.x10, count: reviews.count });

  if (parts.length === 0) {
    const missing = ctx.decides.filter((a) => !known(pick.product, a)).slice(0, 2);
    push(missing.length ? { kind: "thin", attrs: missing } : { kind: "value", matching: ctx.pool.length });
  }
  return parts;
}

// ---------------------------------------------------------------- the catch

export type Catch =
  /** On a number or class: the best available value and what it costs compared with this pick. */
  | { kind: "attr"; attr: string; mine: unknown; best: unknown; extraCents: number; productId: string }
  /** A feature this pick lacks: the cheapest product that has it. */
  | { kind: "feature"; attr: string; extraCents: number; productId: string };

/**
 * What this pick is not, against the best in budget (§3 A5), on the shopper's
 * priority first, then the deciding attributes. Null when it is the best on
 * all of them as far as the data shows.
 */
export function catchFor(pick: Candidate, pool: Candidate[], targets: Target[]): Catch | null {
  for (const t of targets) {
    const mine = goodness(pick.product, t);
    if (mine === null) continue;
    const better = pool
      .filter((c) => c !== pick && c.product.id !== pick.product.id)
      .map((c) => ({ c, v: goodness(c.product, t) }))
      .filter((x): x is { c: Candidate; v: number } => x.v !== null && x.v - mine >= minLead(t));
    if (better.length === 0) continue;
    if (t.kind === "bool") {
      const cheapest = better.sort((a, b) => a.c.price - b.c.price)[0]!.c;
      return {
        kind: "feature",
        attr: t.attr,
        extraCents: cheapest.price - pick.price,
        productId: cheapest.product.id,
      };
    }
    const bestV = Math.max(...better.map((x) => x.v));
    const best = better.filter((x) => x.v === bestV).sort((a, b) => a.c.price - b.c.price)[0]!.c;
    return {
      kind: "attr",
      attr: t.attr,
      mine: pick.product.attributes[t.attr],
      best: best.product.attributes[t.attr],
      extraCents: best.price - pick.price,
      productId: best.product.id,
    };
  }
  return null;
}

// ---------------------------------------------------------------- why not

export type WhyNotReason =
  | {
      kind: "fit";
      questionId: string;
      attr: string | null;
      value: unknown;
      max: number | null;
      chosen: string[];
    }
  | { kind: "unknown"; attrs: string[] }
  | { kind: "over_budget"; overCents: number }
  | { kind: "discontinued" }
  | { kind: "dominated"; byId: string; extraCents: number }
  | { kind: "weaker"; byId: string; extraCents: number };

export type WhyNot = {
  product: ProductView;
  priceCents: number;
  /** Why this one was looked at: the cheapest, the best-graded brand, the most shops, the best reviews. */
  because: "cheapest" | "brand" | "shops" | "reviews";
  reason: WhyNotReason;
};

export type WhyNotInput = {
  products: ProductView[];
  sub: Subcategory;
  answers: Answers;
  budget: PriceBounds;
  urgency: Urgency;
  picks: Candidate[];
  /** Every scored candidate at any price (rank's candidatePool, unknown fit included). */
  scored: Candidate[];
  table?: BrandTable;
};

/** At most this many "Kāpēc ne šie?" lines. */
export const WHY_NOT_MAX = 4;

function fitReason(p: ProductView, q: Question, answers: Answers): WhyNotReason {
  const attr = questionAttrs(q)[0] ?? null;
  const a = answers[q.id];
  const max = q.type === "range" && a && typeof a === "object" && !Array.isArray(a) ? (a.max ?? null) : null;
  return {
    kind: "fit",
    questionId: q.id,
    attr,
    value: attr ? (p.attributes[attr] ?? null) : null,
    max,
    chosen: activeOptions(q, answers).map((o) => o.label),
  };
}

/**
 * The products a shopper is most likely to meet elsewhere, with the one
 * factual reason each is not a pick (§3 A4): the cheapest in range, the
 * best-graded brand, the one most shops sell and the best reviewed. A
 * product without a reason the data can state is left out.
 */
export function whyNot(input: WhyNotInput): WhyNot[] {
  const table = input.table ?? brandTable;
  const picked = new Set(input.picks.map((p) => p.product.id));
  const max = input.budget?.max;
  const stretch = max === undefined ? Infinity : Math.round(max * 1.25);
  const min = input.budget?.min ?? 0;
  const offered = input.products
    .filter((p) => !picked.has(p.id))
    .map((p) => ({ p, offer: bestOffer(eligibleOffers(p, "new", input.urgency)) }))
    .filter((x): x is { p: ProductView; offer: NonNullable<typeof x.offer> } => !!x.offer)
    .filter((x) => x.offer.priceCents >= min);
  const inRange = offered.filter((x) => max === undefined || x.offer.priceCents <= max);
  const near = offered.filter((x) => x.offer.priceCents <= stretch);

  const chosen: { p: ProductView; price: number; because: WhyNot["because"] }[] = [];
  const add = (x: (typeof offered)[number] | undefined, because: WhyNot["because"]) => {
    if (x && !chosen.some((c) => c.p.id === x.p.id))
      chosen.push({ p: x.p, price: x.offer.priceCents, because });
  };
  add([...inRange].sort((a, b) => a.offer.priceCents - b.offer.priceCents)[0], "cheapest");
  if (table.reviewed && !ungradedSubcategory(table, input.sub.id)) {
    const graded = near
      .map((x) => ({ x, g: gradeOf(table, x.p.brand, input.sub.id) ?? 0 }))
      .filter((y) => y.g >= 4)
      .sort((a, b) => b.g - a.g || a.x.offer.priceCents - b.x.offer.priceCents);
    add(graded[0]?.x, "brand");
  }
  const shops = (p: ProductView) =>
    new Set(p.offers.filter((o) => o.stock !== "out").map((o) => o.storeId)).size;
  const widest = [...near].sort(
    (a, b) => shops(b.p) - shops(a.p) || a.offer.priceCents - b.offer.priceCents,
  )[0];
  if (widest && shops(widest.p) > 1) add(widest, "shops");
  const reviewed = near
    .map((x) => ({ x, r: reviewSummary(x.p) }))
    .filter((y) => y.r !== null)
    .sort((a, b) => b.r!.x10 - a.r!.x10 || b.r!.count - a.r!.count)[0];
  add(reviewed?.x, "reviews");

  const scored = new Map(input.scored.map((c) => [c.product.id, c]));
  const out: WhyNot[] = [];
  for (const c of chosen) {
    const reason = reasonFor(c.p, c.price, input, scored);
    if (reason) out.push({ product: c.p, priceCents: c.price, because: c.because, reason });
    if (out.length >= WHY_NOT_MAX) break;
  }
  return out;
}

function reasonFor(
  p: ProductView,
  price: number,
  input: WhyNotInput,
  scored: Map<string, Candidate>,
): WhyNotReason | null {
  const verdict = passesHardFilters(p, input.sub, input.answers);
  if (!verdict.pass) {
    const q = input.sub.questions.find((x) => x.id === verdict.failedQuestion);
    return q ? fitReason(p, q, input.answers) : null;
  }
  if (verdict.fitUnknown) return { kind: "unknown", attrs: verdict.unconfirmed };
  const max = input.budget?.max;
  if (max !== undefined && price > max) return { kind: "over_budget", overCents: price - max };
  if (p.attributes.discontinued === true) return { kind: "discontinued" };
  const me = scored.get(p.id);
  if (!me) return null;
  const dominator = [...input.picks]
    .filter((k) => k.price <= price && k.score >= me.score)
    .sort((a, b) => b.score - a.score)[0];
  if (dominator)
    return { kind: "dominated", byId: dominator.product.id, extraCents: price - dominator.price };
  const better = [...input.picks].filter((k) => k.score > me.score).sort((a, b) => a.price - b.price)[0];
  if (better) return { kind: "weaker", byId: better.product.id, extraCents: better.price - price };
  return null;
}

// ---------------------------------------------------------------- price

export type PriceConfidence = {
  /** How many shops sell it in stock, and the gap between the cheapest and the dearest. */
  shops: number;
  spreadCents: number | null;
  /** "lowest": the lowest price we have seen; "stable": within 3 % for 30 days; "was_lower": cheaper recently. */
  history:
    { kind: "lowest" } | { kind: "stable" } | { kind: "was_lower"; cents: number; daysAgo: number } | null;
};

/** Days of history needed before "stable" or "lowest" may be said. */
export const MIN_HISTORY_DAYS = 14;

/**
 * How settled the price is (§3 B6), from the daily lowest price across shops
 * (`history`, oldest first, "YYYY-MM-DD") and today's offers. Says nothing it
 * cannot show: no history, no claim.
 */
export function priceConfidence(
  p: ProductView,
  currentCents: number,
  history: { day: string; priceCents: number }[],
  now: Date,
): PriceConfidence {
  const live = p.offers.filter((o) => o.condition === "new" && o.stock !== "out").map((o) => o.priceCents);
  const shops = new Set(
    p.offers.filter((o) => o.condition === "new" && o.stock !== "out").map((o) => o.storeId),
  ).size;
  const spreadCents = live.length > 1 ? Math.max(...live) - Math.min(...live) : null;
  const dayMs = 86_400_000;
  const ageDays = (d: string) => Math.round((now.getTime() - Date.parse(`${d}T12:00:00Z`)) / dayMs);
  const last30 = history.filter((h) => ageDays(h.day) <= 30);
  const span = history.length ? ageDays(history[0]!.day) : 0;
  let result: PriceConfidence["history"] = null;
  if (last30.length) {
    const low = last30.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));
    if (low.priceCents < currentCents * 0.97) {
      result = { kind: "was_lower", cents: low.priceCents, daysAgo: Math.max(1, ageDays(low.day)) };
    } else if (span >= 30 && history.every((h) => h.priceCents >= currentCents)) {
      result = { kind: "lowest" };
    } else if (
      span >= MIN_HISTORY_DAYS &&
      last30.every((h) => Math.abs(h.priceCents - currentCents) <= currentCents * 0.03)
    ) {
      result = { kind: "stable" };
    }
  }
  return { shops, spreadCents, history: result };
}

// ---------------------------------------------------------------- coverage

export type Coverage = { products: number; shops: number; updatedAt: Date | null };

/** "Izskatījām 47 ledusskapjus 6 veikalos": every product a shop has in stock now, and when we last looked. */
export function coverage(products: ProductView[], urgency: Urgency): Coverage {
  const shops = new Set<string>();
  let n = 0;
  let updated: number | null = null;
  for (const p of products) {
    const live = eligibleOffers(p, "new", urgency);
    if (live.length === 0) continue;
    n++;
    for (const o of live) {
      shops.add(o.storeId);
      const t = o.lastSeenAt?.getTime();
      if (t !== undefined && (updated === null || t > updated)) updated = t;
    }
  }
  return { products: n, shops: shops.size, updatedAt: updated === null ? null : new Date(updated) };
}
