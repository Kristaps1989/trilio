import type { Catch, PriceConfidence, Role, VerdictPart, WhyNot } from "@/domain/confidence/confidence";
import type { ProductView } from "@/domain/catalog/types";
import { formatEur, formatInt, formatNumber } from "@/i18n/format";

// Turns the structured confidence output (src/domain/confidence) into the
// page's sentences through the translator. Kept out of the domain so no copy
// lives in business logic; every number comes from the data passed in.

type Translator = (key: string, values?: Record<string, string | number>) => string;

export type TextContext = {
  t: Translator;
  /** "Trokšņa līmenis", "Tilpums": the attribute's label. */
  attrLabel: (key: string) => string;
  /** A value with its unit, as the compare table shows it ("36 dB", "300 L", "Ir"). */
  attrValue: (key: string, value: unknown) => string;
  /** A feature's name as the upgrade box says it ("No Frost", "invertors"). */
  featureName: (key: string) => string;
  /** The feature after "bez" / "ar", in the right case ("bez HEPA filtra", "ar HEPA filtru"). */
  featureWithout: (key: string) => string;
  featureWith: (key: string) => string;
  /** The phrase for a flow answer ("{answer} cilvēkiem {value} ir īstais izmērs"), if the category has one. */
  answerPhrase: (questionId: string) => string | null;
  /** The product's display name. */
  nameOf: (id: string) => string;
  /** "Dreame AF30-WH": the product named inside a sentence (docs/TRUST_POLISH_PLAN.md §3). */
  shortNameOf?: (id: string) => string;
};

const stars = (x10: number) => formatNumber(x10 / 10, 1);

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? `{${k}}`);
}

export function roleLabel(role: Role, priorityLabel: string, t: Translator): string {
  switch (role) {
    case "sensible":
      return t("roleSensible");
    case "priority":
      return t("rolePriority", { label: priorityLabel });
    case "lasting":
      return t("roleLasting");
    case "cheapest_good":
      return t("roleCheapest");
  }
}

const LEADS: Record<string, string> = {
  noise_db: "leadsNoise",
  energy_class: "leadsEnergy",
  volume_l: "leadsBig",
  capacity_kg: "leadsBig",
  place_settings: "leadsBig",
  bin_l: "leadsBig",
  programme_min: "leadsFast",
  weight_kg: "leadsLight",
  run_min: "leadsLonger",
  power_w: "leadsStrong",
  airflow_m3h: "leadsStrong",
  suction_pa: "leadsStrong",
  suction_aw: "leadsStrong",
};

/** One or two sentences, strongest claim first (§3 A3). */
export function verdictText(parts: VerdictPart[], ctx: TextContext): string {
  const { t } = ctx;
  return parts
    .map((p) => {
      switch (p.kind) {
        case "answer_fit": {
          const phrase = ctx.answerPhrase(p.questionId);
          const value = ctx.attrValue(p.attr, p.value);
          return phrase ? `${fill(phrase, { answer: p.answer, value })}.` : "";
        }
        case "leads": {
          const scope = t(p.ofPool ? "scopePool" : "scopePicks");
          if (typeof p.value === "boolean")
            return t("leadsFeature", { feature: ctx.featureName(p.attr), scope });
          const key = LEADS[p.attr];
          const value = p.attr === "energy_class" ? String(p.value) : ctx.attrValue(p.attr, p.value);
          return key
            ? t(key, { scope, value })
            : t("leadsGeneric", { scope, label: ctx.attrLabel(p.attr).toLowerCase(), value });
        }
        case "reliable":
          return t("verdictReliable", { brand: p.brand, grade: p.grade });
        case "tco":
          return t("verdictTco", { extra: formatEur(p.extraCents), saved: formatEur(p.savedCents) });
        case "cheapest_sound":
          return t("verdictCheapest");
        case "reviews":
          return t("verdictReviews", { score: stars(p.x10), count: p.count });
        case "thin":
          return t("verdictThin", { attrs: p.attrs.map((a) => ctx.attrLabel(a).toLowerCase()).join(", ") });
        case "value":
          return t("verdictValue", { count: p.matching });
        case "cheaper":
          return t("verdictCheaper", {
            amount: formatEur(p.savedCents),
            name: (ctx.shortNameOf ?? ctx.nameOf)(p.byId),
          });
      }
    })
    .filter(Boolean)
    .join(" ");
}

/** Whole euros: "maksā par 40 € vairāk", never "par 39,99 € vairāk" (the card shows exact prices). */
function cost(extraCents: number, t: Translator): string {
  const euros = Math.round(extraCents / 100);
  if (euros > 0) return t("costMore", { amount: formatEur(euros * 100) });
  return t("costSame");
}

const NAME_MARK = "\u2063";

/**
 * "Bet: darbības laiks 90 min. Hisense HVC646541A ar 108 min maksā par 40 € vairāk."
 * "Bet: bez grīdas mazgāšanas. Dreame X ar grīdas mazgāšanu maksā par 40 € vairāk."
 * Split around the product's name so the card can link it to that product.
 */
export function catchParts(c: Catch, ctx: TextContext): { before: string; name: string; after: string } {
  const name = (ctx.shortNameOf ?? ctx.nameOf)(c.productId);
  const text =
    c.kind === "feature"
      ? ctx.t("catchFeature", {
          without: ctx.featureWithout(c.attr),
          with: ctx.featureWith(c.attr),
          name: NAME_MARK,
          cost: cost(c.extraCents, ctx.t),
        })
      : ctx.t("catchAttr", {
          label: ctx.attrLabel(c.attr).toLowerCase(),
          mine: c.attr === "energy_class" ? String(c.mine) : ctx.attrValue(c.attr, c.mine),
          best: c.attr === "energy_class" ? String(c.best) : ctx.attrValue(c.attr, c.best),
          name: NAME_MARK,
          cost: cost(c.extraCents, ctx.t),
        });
  const [before, after = ""] = ctx.t("catch", { text }).split(NAME_MARK);
  return { before: before!, name, after };
}

/** The catch as one plain sentence. */
export function catchText(c: Catch, ctx: TextContext): string {
  const p = catchParts(c, ctx);
  return `${p.before}${p.name}${p.after}`;
}

/** One line under the price (§3 B6); null when nothing settled can be said. */
export function priceNoteText(pc: PriceConfidence, priceCents: number, t: Translator): string | null {
  const parts: string[] = [];
  if (pc.history?.kind === "lowest") parts.push(t("priceLowest"));
  else if (pc.history?.kind === "stable") parts.push(t("priceStable"));
  if (pc.shops > 1 && pc.spreadCents !== null && pc.spreadCents <= Math.max(500, priceCents * 0.05))
    parts.push(t("priceSpread", { shops: pc.shops, amount: formatEur(pc.spreadCents) }));
  if (!parts.length) return null;
  const text = parts.join("; ");
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
}

/** The reason line of one "Kāpēc ne šie?" product (§3 A4), one sentence with a capital and a full stop. */
export function whyNotText(w: WhyNot, ctx: TextContext): string {
  const { t } = ctx;
  const r = w.reason;
  const name = ctx.shortNameOf ?? ctx.nameOf;
  switch (r.kind) {
    case "fit":
      if (r.attr && r.max !== null && r.value !== null)
        return t("whyFitRange", {
          label: ctx.attrLabel(r.attr),
          value: ctx.attrValue(r.attr, r.value),
          max: ctx.attrValue(r.attr, r.max),
        });
      if (r.attr && r.value !== null && typeof r.value === "number")
        return t("whyFitValue", {
          label: ctx.attrLabel(r.attr),
          value: ctx.attrValue(r.attr, r.value),
          chosen: r.chosen.join(", "),
        });
      return t("whyFitChoice", { chosen: r.chosen.join(", ") });
    case "unknown":
      return t("whyUnknown", { attrs: r.attrs.map((a) => ctx.attrLabel(a).toLowerCase()).join(", ") });
    case "over_budget":
      return t("whyOver", { amount: formatEur(r.overCents) });
    case "discontinued":
      return t("whyDiscontinued");
    case "dominated":
      return r.extraCents > 0
        ? t("whyDominated", { amount: formatEur(r.extraCents), name: name(r.byId) })
        : t("whyDominatedSame", { name: name(r.byId) });
    case "weaker":
      return t("whyWeaker", {
        name: name(r.byId),
        amount: formatEur(r.extraCents),
        gains: r.gains
          .map((g) =>
            typeof g.theirs === "boolean"
              ? t("whyGainFeature", { feature: ctx.featureName(g.attr) })
              : t("whyGain", {
                  label: ctx.attrLabel(g.attr).toLowerCase(),
                  theirs: g.attr === "energy_class" ? String(g.theirs) : ctx.attrValue(g.attr, g.theirs),
                  mine: g.attr === "energy_class" ? String(g.mine) : ctx.attrValue(g.attr, g.mine),
                }),
          )
          .join(", "),
      });
  }
}

/** Evidence lines for a card: reliability is said elsewhere; these are reviews, warranty and the model's age. */
export function factLines(
  p: ProductView,
  reviews: { x10: number; count: number; shops: number } | null,
  t: Translator,
): string[] {
  const out: string[] = [];
  if (reviews)
    out.push(t("factReviews", { score: stars(reviews.x10), count: reviews.count, shops: reviews.shops }));
  const months = typeof p.attributes.warranty_months === "number" ? p.attributes.warranty_months : null;
  if (months !== null)
    out.push(
      months % 12 === 0
        ? t("factWarranty", { years: months / 12 })
        : t("factWarrantyMonths", { months: formatInt(months) }),
    );
  else out.push(t("factWarrantyLegal"));
  if (p.attributes.discontinued === true) out.push(t("factDiscontinued"));
  else if (typeof p.attributes.model_year === "number")
    out.push(t("factModelYear", { year: String(p.attributes.model_year) }));
  return out;
}

/**
 * Lines every card shows the same (the legal warranty, one size bucket) say
 * nothing about the choice: they are said once for all (docs/TRUST_POLISH_PLAN.md §2).
 */
export function sharedLines(cards: { whyFits: string[]; facts: string[] }[]): string[] {
  if (cards.length < 2) return [];
  const [first, ...rest] = cards;
  return [...first!.whyFits, ...first!.facts].filter((line) =>
    rest.every((c) => c.whyFits.includes(line) || c.facts.includes(line)),
  );
}
