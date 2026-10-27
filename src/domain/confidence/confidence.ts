import { directionIn } from "@/domain/catalog/attributes";
import { sameModel } from "@/domain/catalog/naming";
import { reviewSummary } from "@/domain/catalog/reviews";
import type { ProductView } from "@/domain/catalog/types";
import { numberAttr } from "@/domain/catalog/types";
import { minStep, numberRule } from "@/domain/delta/delta";
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

/** `targetOf` with the category's own direction (power is no gain in an air fryer; docs/TRUST_POLISH_PLAN.md §4). */
export function targetIn(attr: string, subcategoryId: string | undefined): Target | null {
  const dir = directionIn(attr, subcategoryId);
  if (dir === "none") return null;
  if (dir) return { attr, kind: dir };
  return targetOf(attr);
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
  for (const a of decides) add(targetIn(a, sub.id));
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
    const t = targetIn(attr, sub.id);
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

export { MIN_REVIEWS, reviewSummary, type ReviewSummary } from "@/domain/catalog/reviews";

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
  | { kind: "value"; matching: number }
  /** Nothing of its own to say: this much cheaper than the next dearer pick. */
  | { kind: "cheaper"; byId: string; savedCents: number };

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

/**
 * The option of a numeric question that best describes the product itself:
 * the tightest threshold its value meets ("11 L" meets "6 porcijas", not just
 * the "4 porcijas" the shopper chose; docs/TRUST_POLISH_PLAN.md §2).
 */
export function bucketOption(
  q: Question,
  p: ProductView,
): { option: Question["options"][number]; attr: string; value: number } | null {
  let best: { option: Question["options"][number]; attr: string; value: number; edge: number } | null = null;
  for (const o of q.options ?? []) {
    const cond = o.match?.find((m) => m.gte !== undefined || m.lte !== undefined);
    if (!cond || (o.match?.length ?? 0) !== 1) continue;
    const value = numberAttr(p, cond.attr);
    if (value === null) continue;
    if ((cond.gte !== undefined && value < cond.gte) || (cond.lte !== undefined && value > cond.lte))
      continue;
    // A higher floor or a lower ceiling describes the product more closely.
    const edge = cond.gte !== undefined ? cond.gte : -cond.lte!;
    if (!best || edge > best.edge) best = { option: o, attr: cond.attr, value, edge };
  }
  return best ? { option: best.option, attr: best.attr, value: best.value } : null;
}

/** Every claim the data supports about a pick, strongest first (§3 A3); the caller picks one or two. */
function verdictCandidates(pick: Candidate, ctx: VerdictContext): VerdictPart[] {
  const table = ctx.table ?? brandTable;
  const parts: VerdictPart[] = [];

  // 1. The shopper's own answer, with the product's number and the size it really is.
  for (const q of ctx.sub.questions) {
    if (!ctx.answerPhrases[q.id]) continue;
    const o = activeOptions(q, ctx.answers)[0];
    const cond = o?.match?.find((m) => m.gte !== undefined || m.lte !== undefined);
    if (!o || !cond) continue;
    const value = numberAttr(pick.product, cond.attr);
    if (value === null) continue;
    if ((cond.gte !== undefined && value < cond.gte) || (cond.lte !== undefined && value > cond.lte))
      continue;
    const bucket = bucketOption(q, pick.product);
    const answer = bucket && bucket.attr === cond.attr ? bucket.option.label : o.label;
    parts.push({ kind: "answer_fit", questionId: q.id, answer, attr: cond.attr, value });
    break;
  }

  // 2. Leads on what matters most: the priority, then the deciding attributes.
  for (const t of ctx.targets) {
    if (!leadsOn(pick, ctx.picks, ctx.pool, t)) continue;
    const best = Math.max(...ctx.pool.map((c) => goodness(c.product, t) ?? -Infinity));
    parts.push({
      kind: "leads",
      attr: t.attr,
      value: pick.product.attributes[t.attr],
      ofPool: goodness(pick.product, t) === best && ctx.pool.length > ctx.picks.length,
    });
    break;
  }

  // 3. Reliability, stated positively, when the evidence is strong.
  const graded = table.reviewed && !ungradedSubcategory(table, ctx.sub.id);
  const grade = graded ? gradeOf(table, pick.product.brand, ctx.sub.id) : null;
  if (grade !== null && grade >= 4) parts.push({ kind: "reliable", brand: pick.product.brand, grade });

  // 4. Cost of ownership against the cheapest pick.
  const cheapest = [...ctx.picks].sort((a, b) => a.price - b.price)[0];
  if (cheapest && cheapest.product.id !== pick.product.id && pick.price > cheapest.price) {
    const mine = energyCost10yCents(pick.product.kwhYear, ctx.energyPriceCentsPerKwh);
    const theirs = energyCost10yCents(cheapest.product.kwhYear, ctx.energyPriceCentsPerKwh);
    if (mine !== null && theirs !== null) {
      const extra = pick.price - cheapest.price;
      const saved = theirs - mine;
      if (saved > extra) parts.push({ kind: "tco", extraCents: extra, savedCents: saved });
    }
  }

  if (ctx.roles.includes("cheapest_good")) parts.push({ kind: "cheapest_sound" });

  const reviews = reviewSummary(pick.product);
  if (reviews && reviews.x10 >= 45) parts.push({ kind: "reviews", x10: reviews.x10, count: reviews.count });
  return parts;
}

function fallbackPart(pick: Candidate, ctx: VerdictContext): VerdictPart {
  const missing = ctx.decides.filter((a) => !known(pick.product, a)).slice(0, 2);
  return missing.length ? { kind: "thin", attrs: missing } : { kind: "value", matching: ctx.pool.length };
}

/** One or two claims about a pick, strongest first, each backed by its data (§3 A3). Never empty. */
export function verdictFor(pick: Candidate, ctx: VerdictContext): VerdictPart[] {
  const parts = verdictCandidates(pick, ctx).slice(0, 2);
  return parts.length ? parts : [fallbackPart(pick, ctx)];
}

/** Two parts that would read the same on two cards. */
function partKey(p: VerdictPart): string {
  switch (p.kind) {
    case "reliable":
      return `reliable:${p.brand.toLowerCase()}:${p.grade}`;
    case "answer_fit":
      return `answer:${p.questionId}:${p.answer}:${p.value}`;
    case "thin":
      return `thin:${p.attrs.join(",")}`;
    case "value":
    case "cheapest_sound":
      return p.kind;
    default:
      return JSON.stringify(p);
  }
}

/**
 * Where a pick is best of the picks on a deciding or compared attribute,
 * by a clear step over each of the others: "Lielākais no šiem variantiem: 11 L".
 */
function contrastFor(pick: Candidate, ctx: VerdictContext, keys: string[]): VerdictPart | null {
  const others = ctx.picks.filter((p) => p.product.id !== pick.product.id);
  if (others.length === 0) return null;
  for (const attr of keys) {
    const t = targetIn(attr, ctx.sub.id);
    if (!t) continue;
    const mine = goodness(pick.product, t);
    if (mine === null) continue;
    const rule = t.kind === "min" || t.kind === "max" ? numberRule(attr, ctx.sub.id) : undefined;
    const ahead = others.every((o) => {
      const v = goodness(o.product, t);
      return v !== null && mine - v >= (rule ? minStep(rule, mine, v) : minLead(t));
    });
    if (ahead) return { kind: "leads", attr, value: pick.product.attributes[attr], ofPool: false };
  }
  return null;
}

export type Verdicts = {
  /** One or two parts per pick id; no part reads the same on two cards. */
  byId: Map<string, VerdictPart[]>;
  /** A graded brand two or more picks share: said once above the cards, not on each. */
  sharedBrand: { brand: string; grade: number; count: number } | null;
};

/**
 * Verdicts for the picks together (docs/TRUST_POLISH_PLAN.md §2): each card
 * says what this pick has that the others do not. A claim used on one card
 * is not repeated on another; a brand grade shared by several picks is said
 * once for all; a pick with nothing of its own says how much less it costs.
 */
export function verdictsFor(ctx: VerdictContext, rolesOf: (id: string) => Role[]): Verdicts {
  const table = ctx.table ?? brandTable;
  const graded = table.reviewed && !ungradedSubcategory(table, ctx.sub.id);
  const brands = new Map<string, { brand: string; grade: number; count: number }>();
  for (const p of ctx.picks) {
    const grade = graded ? gradeOf(table, p.product.brand, ctx.sub.id) : null;
    if (grade === null || grade < 4) continue;
    const key = p.product.brand.toLowerCase();
    const e = brands.get(key) ?? { brand: p.product.brand, grade, count: 0 };
    e.count++;
    brands.set(key, e);
  }
  const shared =
    [...brands.values()].filter((b) => b.count >= 2).sort((a, b) => b.count - a.count)[0] ?? null;

  const keys = [...new Set([...ctx.targets.map((t) => t.attr), ...ctx.decides, ...ctx.sub.compare])];
  const used = new Set<string>();
  const byId = new Map<string, VerdictPart[]>();
  const sorted = [...ctx.picks].sort((a, b) => a.price - b.price);
  for (const pick of sorted) {
    const own = { ...ctx, roles: rolesOf(pick.product.id) };
    const candidates = verdictCandidates(pick, own).filter(
      (p) => !(p.kind === "reliable" && shared && p.brand.toLowerCase() === shared.brand.toLowerCase()),
    );
    const contrast = contrastFor(pick, own, keys);
    if (contrast && !candidates.some((c) => c.kind === "leads")) {
      // The answer first when there is one, then what sets this pick apart.
      candidates.splice(candidates[0]?.kind === "answer_fit" ? 1 : 0, 0, contrast);
    }
    const dearer = sorted.filter((o) => o.price > pick.price);
    const next = dearer[0];
    if (next)
      candidates.push({ kind: "cheaper", byId: next.product.id, savedCents: next.price - pick.price });

    const parts: VerdictPart[] = [];
    for (const c of candidates) {
      if (parts.length === 2) break;
      const key = partKey(c);
      if (used.has(key)) continue;
      used.add(key);
      parts.push(c);
    }
    byId.set(pick.product.id, parts.length ? parts : [fallbackPart(pick, own)]);
  }
  return { byId, sharedBrand: shared };
}

// ---------------------------------------------------------------- the catch

export type Catch =
  /** On a number or class: the nearest clearly better value in budget (`best`) and its price difference. */
  | { kind: "attr"; attr: string; mine: unknown; best: unknown; extraCents: number; productId: string }
  /** A feature this pick lacks: the cheapest product that has it. */
  | { kind: "feature"; attr: string; extraCents: number; productId: string };

/** A step up may cost at most this share of the pick's price; dearer ones are no fair "but". */
export const CATCH_MAX_SHARE = 0.5;

/**
 * What this pick is not (§3 A5), on the shopper's priority first, then the
 * deciding attributes: the nearest real step up, i.e. the cheapest product in
 * budget that is clearly better on that attribute, not the very best one at
 * the top of the budget. A step dearer than CATCH_MAX_SHARE of the pick's
 * price moves on to the next attribute. Products in `avoid` (already named on
 * another card) are not named again. Null when nothing fair can be said.
 */
export function catchFor(
  pick: Candidate,
  pool: Candidate[],
  targets: Target[],
  avoid: ReadonlySet<string> = new Set(),
): Catch | null {
  for (const t of targets) {
    const mine = goodness(pick.product, t);
    if (mine === null) continue;
    const step = pool
      .filter((c) => c !== pick && c.product.id !== pick.product.id && !avoid.has(c.product.id))
      .map((c) => ({ c, v: goodness(c.product, t) }))
      .filter((x): x is { c: Candidate; v: number } => x.v !== null && x.v - mine >= minLead(t))
      .filter((x) => x.c.price - pick.price <= pick.price * CATCH_MAX_SHARE)
      .sort((a, b) => a.c.price - b.c.price || b.v - a.v)[0];
    if (!step) continue;
    const extraCents = step.c.price - pick.price;
    if (t.kind === "bool") return { kind: "feature", attr: t.attr, extraCents, productId: step.c.product.id };
    return {
      kind: "attr",
      attr: t.attr,
      mine: pick.product.attributes[t.attr],
      best: step.c.product.attributes[t.attr],
      extraCents,
      productId: step.c.product.id,
    };
  }
  return null;
}

/** The catch of each pick, in order, never naming the same product on two cards. */
export function catchesFor(picks: Candidate[], pool: Candidate[], targets: Target[]): Map<string, Catch> {
  const named = new Set<string>();
  const out = new Map<string, Catch>();
  for (const pick of picks) {
    const c = catchFor(pick, pool, targets, named);
    if (!c) continue;
    named.add(c.productId);
    out.set(pick.product.id, c);
  }
  return out;
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
  /** A pick costs `extraCents` more and is measurably better on `gains` (never empty). */
  | { kind: "weaker"; byId: string; extraCents: number; gains: Gain[] };

/** One measurable advantage, with both values: "tilpums 9 L (šim 2,5 L)". */
export type Gain = { attr: string; theirs: unknown; mine: unknown };

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
  /** The category's deciding attributes (knowledge.json), compared before the compare list. */
  decides: string[];
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
  // A colour or finish variant of a pick is the same choice, not an alternative (docs/TRUST_POLISH_PLAN.md §3).
  const variantOfPick = (p: ProductView) => input.picks.some((k) => sameModel(k.product, p));
  const max = input.budget?.max;
  const stretch = max === undefined ? Infinity : Math.round(max * 1.25);
  const min = input.budget?.min ?? 0;
  const offered = input.products
    .filter((p) => !picked.has(p.id) && !variantOfPick(p))
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
  // A pick that is better on something the shopper can see, cheapest first; "better overall" alone is no reason.
  const keys = [...input.decides, ...input.sub.compare];
  for (const k of [...input.picks].filter((x) => x.score > me.score).sort((a, b) => a.price - b.price)) {
    const gains = gainsOf(k.product, p, keys, input.sub.id);
    if (gains.length) return { kind: "weaker", byId: k.product.id, extraCents: k.price - price, gains };
  }
  return null;
}

/** Where `by` is measurably better than `p` on `keys`, in order, at most two. */
export function gainsOf(by: ProductView, p: ProductView, keys: string[], subcategoryId: string): Gain[] {
  const out: Gain[] = [];
  for (const attr of new Set(keys)) {
    const t = targetIn(attr, subcategoryId);
    if (!t) continue;
    const a = goodness(by, t);
    const b = goodness(p, t);
    if (a === null || b === null) continue;
    const rule = t.kind === "min" || t.kind === "max" ? numberRule(attr, subcategoryId) : undefined;
    if (a - b < (rule ? minStep(rule, a, b) : minLead(t))) continue;
    out.push({ attr, theirs: by.attributes[attr], mine: p.attributes[attr] });
    if (out.length === 2) break;
  }
  return out;
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
