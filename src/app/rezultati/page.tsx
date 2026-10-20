import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db, searchSessions } from "@/db";
import { loadCandidates } from "@/db/queries/catalog";
import { adviceNotes, DEFAULT_COSTS, type AdviceNote } from "@/domain/advice/advice";
import { canonicalBrand, displayName } from "@/domain/catalog/naming";
import type { OfferView, ProductView } from "@/domain/catalog/types";
import { deliveryDate, urgencyDate, workingDaysUntil } from "@/domain/delivery/delivery";
import { upgradeDelta } from "@/domain/delta/delta";
import {
  ENERGY_SUBCATEGORIES,
  energyCost10yCents,
  energyPriceFromEnv,
  tcoCents,
} from "@/domain/energy/energy";
import { optionCounts, priceStats } from "@/domain/flow/insight";
import {
  budgetCents,
  decodeState,
  encodeState,
  priceRange,
  withSetting,
  type FlowState,
} from "@/domain/flow/state";
import { priceLine } from "@/domain/pricing/omnibus";
import { chosenOptions, isRangeAnswer, visibleQuestions } from "@/domain/questions/engine";
import { getGroupOfSubcategory, getSubcategory } from "@/domain/questions/catalog";
import type { Answers, Question, Subcategory } from "@/domain/questions/schema";
import { brandTable, gradeOf, worthConsidering } from "@/domain/ranking/consider";
import { candidatePool, rank, type Pick, type RefurbishedPick } from "@/domain/ranking/rank";
import { relaxations, type Relaxation } from "@/domain/ranking/relax";
import { whyItFits } from "@/domain/ranking/score";
import { formatDateDative, formatEur, formatInt, formatNumber, formatRating } from "@/i18n/format";
import { currentMarket } from "@/i18n/market";
import { ButtonLink } from "@/ui/Button";
import { Kicker, Page, PageTitle, Panel, SectionTitle } from "@/ui/layout";
import { betterDirection, enumLabels, formatAttr } from "./attr-format";
import { CompareTable, type CompareColumn, type CompareRow } from "./CompareTable";
import { deltaLines } from "./delta-text";
import { FilterBar, type Chip } from "./FilterBar";
import { HowWeRank } from "./HowWeRank";
import { CardRow, ResultCard, type CardModel, type CardOffer } from "./ResultCard";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ sub?: string; a?: string; vairak?: string }> };

/** "Rādīt vairāk variantus" adds this many cards per tap. */
const MORE_STEP = 10;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("results");
  return { title: t("title") };
}

function cardOffer(o: OfferView, now: Date): CardOffer {
  const date = deliveryDate(o, now, currentMarket().country);
  return {
    id: o.id,
    storeName: o.storeName,
    priceCents: o.priceCents,
    stock: o.stock === "soon" ? "soon" : "in",
    deliveryDate: date ? formatDateDative(date) : null,
    deliveryDays: workingDaysUntil(o),
  };
}

const href = (sub: Subcategory, state: FlowState) => `/rezultati?sub=${sub.id}&a=${encodeState(state)}`;

export default async function ResultsPage({ searchParams }: Props) {
  const { sub: subId, a, vairak } = await searchParams;
  const sub = subId ? getSubcategory(subId) : undefined;
  const group = sub ? getGroupOfSubcategory(sub.id) : undefined;
  if (!sub || !group) notFound();

  const t = await getTranslations("results");
  const td = await getTranslations("delta");
  const ta = await getTranslations("attr");
  const tp = await getTranslations("productType");
  const tu = await getTranslations("urgency");
  const state = decodeState(sub, a);
  const budget = priceRange(state);
  const urgency = state.trailing.urgency ?? "two_weeks";
  const now = new Date();
  const energyPrice = energyPriceFromEnv();
  const costs = { ...DEFAULT_COSTS, energyCentsPerKwh: energyPrice };
  const enums = enumLabels(sub);
  const attrLabel = (key: string) => (ta.has(key as "width_cm") ? ta(key as "width_cm") : key);
  const enumLabel = (key: string, value: string) => enums[key]?.[value] ?? value;
  const typeLabel = tp.has(sub.id as "fridge") ? tp(sub.id as "fridge") : "";
  const nameOf = (p: ProductView) => displayName(p.name, p.brand, sub.id, typeLabel);

  const products = await loadCandidates(db, sub.id);
  const input = {
    products,
    sub,
    answers: state.answers,
    budget,
    urgency,
    brands: state.trailing.brands,
    brandsOnly: state.trailing.brandsOnly,
    showUnknown: state.trailing.showUnknown,
  };
  const result = rank({ ...input, includeRefurbished: state.trailing.refurbished !== "no" });

  // Saved requirements (spec DATA_MODEL SearchSession); also the click attribution key.
  const [session] = await db
    .insert(searchSessions)
    .values({
      subcategoryId: sub.id,
      answers: { ...state.answers, $trailing: state.trailing },
      budgetCents: budgetCents(state),
    })
    .returning({ id: searchSessions.id })
    .catch(() => [] as { id: string }[]);
  const sessionId = session?.id ?? null;

  const tierLabel = (tier: NonNullable<Pick["tier"]>) =>
    t(`tier${tier[0]!.toUpperCase()}${tier.slice(1)}` as "tierBudget");
  const cheapest = result.picks[0] ?? null;
  const basePath = `/izvelies/${group.id}/${sub.id}`;

  function energyFor(p: ProductView, price: number) {
    if (!ENERGY_SUBCATEGORIES.has(sub!.id)) return null;
    const cost = energyCost10yCents(p.kwhYear, energyPrice);
    const total = tcoCents(price, p.kwhYear, energyPrice);
    return cost !== null && total !== null ? { cost10yCents: cost, totalCents: total } : null;
  }

  function otherOffers(p: ProductView, best: OfferView) {
    const others = p.offers
      .filter((o) => o.condition === best.condition && o.stock !== "out" && o.id !== best.id)
      .sort((x, y) => x.priceCents - y.priceCents);
    const max = Math.max(best.priceCents, ...others.map((o) => o.priceCents));
    return {
      list: others.map((o) => ({ storeName: o.storeName, priceCents: o.priceCents })),
      savingVsMaxCents: others.length && max > best.priceCents ? max - best.priceCents : null,
    };
  }

  // Feeds without a spec line still get one: the first known compare attributes.
  const specsOf = (p: ProductView): string | null => {
    if (p.specs) return p.specs;
    const parts: string[] = [];
    for (const key of sub!.compare) {
      const v = p.attributes[key];
      if (v === undefined || v === null || v === "" || v === false) continue;
      // Sizes say which size they are ("dziļums 63 cm"); other values read on their own.
      const value = v === true ? attrLabel(key) : formatAttr(key, v, ta, enums);
      parts.push(key.endsWith("_cm") ? `${attrLabel(key).toLowerCase()} ${value}` : value);
      if (parts.length === 4) break;
    }
    return parts.length ? parts.join(" · ") : null;
  };

  const unknownText = (keys: string[]) => keys.map((k) => attrLabel(k).toLowerCase()).join(", ");

  // Brand reliability earns a "why" line only when it lifted the pick (grade 4–5 with solid evidence).
  const brandLine = (pick: Pick): string[] => {
    const grade = gradeOf(brandTable, pick.product.brand, sub!.id);
    return (pick.quality?.brand ?? 0) >= 8 && grade !== null ? [t("brandReliable", { grade })] : [];
  };

  function toCard(pick: Pick): CardModel {
    const others = otherOffers(pick.product, pick.offer);
    let upgrade: CardModel["upgrade"] = null;
    if (cheapest && pick.product.id !== cheapest.product.id) {
      const d = upgradeDelta(
        { product: cheapest.product, priceCents: cheapest.offer.priceCents },
        { product: pick.product, priceCents: pick.offer.priceCents },
        energyPrice,
        sub!.compare,
      );
      // §2.8: say nothing rather than guess when the specs are not known on both sides.
      if (d.status !== "unknown") {
        upgrade = {
          priceDeltaCents: d.priceDeltaCents,
          tierLabel: cheapest.tier ? tierLabel(cheapest.tier) : t("cheapestOption"),
          lines: d.status === "differs" ? deltaLines(d.items, td, attrLabel, enumLabel) : [],
          note: d.status === "same" ? (d.brandsDiffer ? t("onlyBrand") : t("sameSpecs")) : null,
        };
      }
    }
    return {
      productId: pick.product.id,
      name: nameOf(pick.product),
      modelCode: pick.product.modelCode,
      ean: pick.product.ean,
      specs: specsOf(pick.product),
      tier: pick.overBudgetByCents > 0 ? null : pick.tier,
      recommended: pick.recommended,
      rating: pick.product.rating,
      best: cardOffer(pick.offer, now),
      overBudgetByCents: pick.overBudgetByCents,
      priceLine: priceLine(pick.offer.priceCents, pick.offer.lowest30dCents),
      whyFits: [...brandLine(pick), ...whyItFits(pick.reasons)].slice(0, 3),
      unconfirmed: pick.fitUnknown ? [] : pick.unconfirmed.map((k) => attrLabel(k).toLowerCase()),
      unknownData: pick.fitUnknown ? unknownText(pick.unconfirmed) : null,
      energy: energyFor(pick.product, pick.offer.priceCents),
      otherOffers: others.list,
      savingVsMaxCents: others.savingVsMaxCents,
      upgrade,
      refurbished: null,
      sessionId,
      trackHref: `/radars/jauns?product=${pick.product.id}&s=${sessionId ?? ""}`,
    };
  }

  function toRefurbCard(pick: RefurbishedPick): CardModel {
    const others = otherOffers(pick.product, pick.offer);
    return {
      ...toCard({ ...pick, tier: null, recommended: false, overBudgetByCents: 0, fitUnknown: false }),
      tier: null,
      upgrade: null,
      otherOffers: others.list,
      savingVsMaxCents: others.savingVsMaxCents,
      refurbished: {
        grade: pick.offer.grade,
        warrantyMonths: pick.offer.warrantyMonths,
        savingVsNewCents: pick.savingVsNewCents,
      },
    };
  }

  const cards = result.picks.map(toCard);
  const extraCards = result.extras.map(toCard);
  // Everything else in range, best value first, on request (the shopper decides how far to look).
  const moreShown = Math.min(result.more.length, Math.max(0, Math.floor(Number(vairak) || 0)));
  const moreCards = result.more
    .slice(0, moreShown)
    .map((c) => ({
      ...toCard({ ...c, tier: null, recommended: false, overBudgetByCents: 0 }),
      upgrade: null,
    }));
  const moreLeft = result.more.length - moreShown;
  const refurbCards = result.refurbished.map(toRefurbCard);

  // "Vērts zināt" (§2.7): about the recommended pick, or the first one.
  const pool = candidatePool(input);
  const focus = result.picks.find((p) => p.recommended) ?? result.picks[0];
  const typeQuestion = sub.questions.find(
    (q) => q.stage === "flow" && q.up_front_reason === "kind" && q.type === "single",
  );
  const anyTypeAnswers: Answers = { ...state.answers };
  if (typeQuestion) delete anyTypeAnswers[typeQuestion.id];
  const notes: AdviceNote[] = focus
    ? adviceNotes({
        subcategoryId: sub.id,
        answers: state.answers,
        pick: { product: focus.product, priceCents: focus.offer.priceCents },
        pool: pool.map((c) => ({ product: c.product, priceCents: c.price })),
        anyType: candidatePool({ ...input, answers: anyTypeAnswers }).map((c) => ({
          product: c.product,
          priceCents: c.price,
        })),
        budgetMaxCents: budget?.max ?? null,
        costs,
      })
    : [];
  const years = (y: number) => formatNumber(Math.max(0.1, Math.ceil(y * 10) / 10));
  function noteText(n: AdviceNote): string {
    switch (n.kind) {
      case "energy_upgrade":
        return t("adviceEnergy", {
          extra: formatEur(n.extraCents),
          to: n.toClass,
          from: n.fromClass,
          saving: formatEur(n.yearlySavingCents),
          years: years(n.paybackYears),
        });
      case "cheaper_similar":
        return t("adviceCheaper", {
          saving: formatEur(n.savingCents),
          energy:
            n.yearlyExtraCents > 0 && n.toClass
              ? t("adviceCheaperEnergy", { to: n.toClass, extra: formatEur(n.yearlyExtraCents) })
              : t("adviceCheaperSame"),
        });
      case "quieter":
        return t("adviceQuieter", {
          extra: formatEur(n.extraCents),
          to: formatInt(n.toDb),
          from: formatInt(n.fromDb),
        });
      case "bigger":
        return t("adviceBigger", { extra: formatEur(n.extraCents), litres: formatInt(n.extraLitres) });
      case "nofrost":
        return t("adviceNoFrost", { extra: formatEur(n.extraCents) });
      case "heatpump":
        return t("adviceHeatpump", {
          extra: formatEur(n.extraCents),
          saving: formatEur(n.yearlySavingCents),
          years: years(n.paybackYears),
        });
      case "coffee_cost":
        return t("adviceCoffee", {
          capsule: formatEur(n.capsuleCupCents),
          bean: formatEur(n.beanCupCents),
          months: formatInt(n.paybackMonths),
        });
      case "bags":
        return (
          t("adviceBags", { amount: formatEur(n.bagsPerYearCents) }) +
          (n.to ? t("adviceBagsAlt", { name: nameOf(n.to.product), price: formatEur(n.to.priceCents) }) : "")
        );
    }
  }
  const offerOf = (p: ProductView) =>
    p.offers
      .filter((o) => o.condition === "new" && o.stock !== "out")
      .sort((x, y) => x.priceCents - y.priceCents)[0];

  // "Vērts apsvērt" (§2.5): only with a reviewed brand table and chosen brands.
  const top = result.picks.find((p) => p.recommended) ?? result.picks[0];
  const consider = worthConsidering(
    pool,
    top && { ...top, price: top.offer.priceCents },
    state.trailing.brands ?? [],
  );

  // Relax suggestions (§4.2) when fewer than three fit.
  const relax: Relaxation[] = result.picks.length < 3 ? relaxations(input) : [];
  const relaxLink = (r: Relaxation): { href: string; text: string } => {
    switch (r.kind) {
      case "price_max":
        return {
          href: href(sub!, withSetting(state, "budget", { ...(budget ?? {}), max: r.maxCents })),
          text: t("relaxPrice", { gain: r.gain, amount: formatEur(r.maxCents) }),
        };
      case "price_min":
        return {
          href: href(sub!, withSetting(state, "budget", { max: budget?.max })),
          text: t("relaxPriceMin", { gain: r.gain }),
        };
      case "range_max": {
        const q = sub.questions.find((x) => x.id === r.questionId)!;
        const answers = { ...state.answers, [q.id]: r.max === null ? {} : { max: r.max } };
        const label = attrLabel(q.range!.attr).toLowerCase();
        return {
          href: href(sub!, { ...state, answers }),
          text:
            r.max === null
              ? t("relaxRangeAny", { gain: r.gain, label })
              : t("relaxRange", {
                  gain: r.gain,
                  label,
                  value: String(r.max).replace(".", ","),
                  unit: r.unit,
                }),
        };
      }
      case "brands":
        return {
          href: href(sub!, withSetting(state, "brandsOnly", undefined)),
          text: t("relaxBrands", { gain: r.gain }),
        };
      case "show_unknown":
        return {
          href: href(sub!, withSetting(state, "showUnknown", true)),
          text: t("relaxUnknown", { gain: r.gain }),
        };
    }
  };

  // Filter bar chips (§4.1).
  const chips: Chip[] = [];
  const qs = visibleQuestions(sub, state.answers);
  const answersWithout = (id: string): Answers => {
    const x = { ...state.answers };
    delete x[id];
    return x;
  };
  function choiceChip(q: Question): Chip {
    const counts =
      q.stage === "flow"
        ? optionCounts({ products, sub: sub!, answers: answersWithout(q.id), urgency }, q)
        : {};
    const chosen = chosenOptions(q, state.answers);
    return {
      id: q.id,
      title: q.title,
      label: chosen.length
        ? chosen.map((o) => o.label).join(", ")
        : q.stage === "results"
          ? t("moreChip")
          : q.title,
      active: chosen.length > 0,
      editor: {
        kind: "choice",
        questionId: q.id,
        multi: q.type === "multi",
        maxSelect: q.max_select,
        clearable: !q.hard_filter || q.stage === "results",
        options: q.options.map((o) => ({
          value: o.value,
          label: o.label,
          sublabel: o.sublabel ?? null,
          count: counts[o.value],
        })),
      },
    };
  }
  for (const q of qs) {
    if (q.stage !== "flow") continue;
    const ans = state.answers[q.id];
    if (q.type === "range") {
      const r = q.range!;
      const label = attrLabel(r.attr);
      const max = isRangeAnswer(ans) ? ans.max : undefined;
      chips.push({
        id: q.id,
        title: q.title,
        label:
          max === undefined
            ? t("rangeAny", { label })
            : t("rangeUpTo", { label, value: String(max).replace(".", ","), unit: r.unit }),
        active: max !== undefined,
        editor: {
          kind: "range",
          questionId: q.id,
          unit: r.unit,
          min: r.min,
          max: r.max,
          step: r.step,
          presets: r.presets ?? [],
        },
      });
    } else if (q.type === "number") {
      if (typeof ans !== "number") continue;
      chips.push({
        id: q.id,
        title: q.title,
        label: t("numberChip", {
          label: attrLabel(q.input!.attr ?? q.id),
          value: formatInt(ans),
          unit: q.input!.unit,
        }),
        active: true,
        editor: {
          kind: "number",
          questionId: q.id,
          min: q.input!.min,
          max: q.input!.max,
          unit: q.input!.unit,
        },
      });
    } else if (ans !== undefined) {
      chips.push(choiceChip(q));
    }
  }
  const stats = priceStats({ products, sub, answers: state.answers, urgency });
  chips.push({
    id: "budget",
    title: t("filterPriceTitle"),
    label: !budget
      ? t("priceAny")
      : budget.min !== undefined && budget.max !== undefined
        ? t("priceRange", { min: formatEur(budget.min), max: formatEur(budget.max) })
        : budget.max !== undefined
          ? t("priceUpTo", { max: formatEur(budget.max) })
          : t("priceFrom", { min: formatEur(budget.min!) }),
    active: !!budget,
    editor: { kind: "price", stats, presetsCents: sub.budget_steps_eur.map((e) => e * 100) },
  });
  for (const q of qs) if (q.stage === "results") chips.push(choiceChip(q));
  // One entry per brand however shops spell it ("SAMSUNG" and "Samsung" are one brand).
  const knownBrands = Object.keys(brandTable.brands);
  const brandCounts = new Map<string, number>();
  for (const c of candidatePool({ ...input, brandsOnly: false })) {
    const name = canonicalBrand(c.product.brand, knownBrands);
    brandCounts.set(name, (brandCounts.get(name) ?? 0) + 1);
  }
  const chosenBrands = [
    ...new Map(
      (state.trailing.brands ?? []).map((b) => [b.toLowerCase(), canonicalBrand(b, knownBrands)]),
    ).values(),
  ];
  if (brandCounts.size > 1) {
    const brands = [...brandCounts.entries()]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .map(([name, count]) => ({ name, count }));
    chips.push({
      id: "brands",
      title: t("brandsChip"),
      label: chosenBrands.length ? chosenBrands.join(", ") : t("brandsAny"),
      active: chosenBrands.length > 0,
      editor: { kind: "brands", brands },
    });
  }
  chips.push({
    id: "urgency",
    title: tu("title"),
    label: `${t("urgencyChip")}: ${tu(urgency === "asap" ? "asap" : urgency === "no_rush" ? "noRush" : "twoWeeks")}`,
    active: urgency !== "two_weeks",
    editor: {
      kind: "urgency",
      options: [
        {
          value: "asap",
          label: tu("asap"),
          sublabel: tu("asapSub", { date: formatDateDative(urgencyDate("asap", now, "LV")) }),
        },
        {
          value: "two_weeks",
          label: tu("twoWeeks"),
          sublabel: tu("twoWeeksSub", { date: formatDateDative(urgencyDate("two_weeks", now, "LV")) }),
        },
        { value: "no_rush", label: tu("noRush"), sublabel: tu("noRushSub") },
      ],
    },
  });
  if (products.some((p) => p.offers.some((o) => o.condition === "refurbished" && o.stock !== "out"))) {
    chips.push({
      id: "refurbished",
      title: t("refurbChip"),
      label: `${t("refurbChip")}: ${state.trailing.refurbished === "no" ? t("refurbOff") : t("refurbOn")}`,
      active: state.trailing.refurbished === "no",
      editor: { kind: "refurbished" },
    });
  }

  // Compare table (spec §3.4) over the category's own attributes.
  const compared = [...result.picks, ...result.extras];
  const columns: CompareColumn[] = compared.map((p) => ({
    name: nameOf(p.product),
    badge:
      p.overBudgetByCents > 0
        ? t("overBudget", { amount: formatEur(p.overBudgetByCents) })
        : p.tier
          ? tierLabel(p.tier)
          : null,
  }));
  const rows: CompareRow[] = [];
  const minIndex = (vals: (number | null)[]) => bestIdx(vals, (x, y) => x < y);
  const maxIndex = (vals: (number | null)[]) => bestIdx(vals, (x, y) => x > y);
  rows.push({
    label: t("rowPrice"),
    values: compared.map((p) => `${formatEur(p.offer.priceCents)} · ${p.offer.storeName}`),
    bestIndex: minIndex(compared.map((p) => p.offer.priceCents)),
    alwaysShow: true,
  });
  rows.push({
    label: t("rowAvailability"),
    values: compared.map((p) => (p.offer.stock === "in" ? t("stockIn") : t("stockSoon"))),
    bestIndex: null,
  });
  rows.push({
    label: t("rowModel"),
    values: compared.map((p) => `${p.product.modelCode} · ${p.product.ean ?? "—"}`),
    bestIndex: null,
    alwaysShow: true,
  });
  for (const key of sub.compare) {
    const raw = compared.map((p) => p.product.attributes[key]);
    if (raw.every((v) => v === undefined || v === null)) continue;
    const nums = raw.map((v) => (typeof v === "number" ? v : null));
    const dir = betterDirection(key);
    rows.push({
      label: attrLabel(key),
      values: raw.map((v) => formatAttr(key, v, (k) => ta(k as "yes"), enums)),
      bestIndex: dir === "min" ? minIndex(nums) : dir === "max" ? maxIndex(nums) : null,
    });
  }
  if (ENERGY_SUBCATEGORIES.has(sub.id)) {
    const costsRow = compared.map((p) => energyCost10yCents(p.product.kwhYear, energyPrice));
    const totals = compared.map((p) => tcoCents(p.offer.priceCents, p.product.kwhYear, energyPrice));
    if (costsRow.some((c) => c !== null)) {
      rows.push({
        label: t("rowEnergy10y"),
        values: costsRow.map((c) => (c === null ? ta("unknown") : formatEur(c))),
        bestIndex: minIndex(costsRow),
      });
      rows.push({
        label: t("rowTco"),
        values: totals.map((c) => (c === null ? ta("unknown") : formatEur(c))),
        bestIndex: minIndex(totals),
      });
    }
  }
  rows.push({
    label: t("rowRating"),
    values: compared.map((p) =>
      p.product.rating === null ? ta("unknown") : `${formatRating(p.product.rating / 10)}/10`,
    ),
    bestIndex: maxIndex(compared.map((p) => p.product.rating)),
    alwaysShow: true,
  });

  const excluded = Object.entries(result.excludedBy)
    .filter(([, n]) => n > 0)
    .map(([id, count]) =>
      t("excludedItem", {
        label: id === "$brands" ? t("brandsChip") : (sub.questions.find((q) => q.id === id)?.title ?? id),
        count,
      }),
    );
  const howItems = [
    t("howFilters"),
    t("howRanking"),
    t("howRecommendation"),
    t("howCommission"),
    t("howEnergy", { price: `${formatInt(energyPrice)} ct` }),
    t("howAdvice", { energy: `${formatInt(energyPrice)} ct`, water: formatEur(costs.waterCentsPerM3) }),
    t("howRefurbished"),
    t("howUnconfirmed"),
    ...(excluded.length ? [t("howExcluded", { items: excluded.join("; ") })] : []),
  ];

  const mid = result.picks.length ? result.picks[Math.floor(result.picks.length / 2)]!.offer.priceCents : 0;
  const lead =
    result.picks.length >= 2 && !result.tiersMeaningful
      ? t("leadSimilar", { amount: formatEur(Math.round(mid / 1000) * 1000) })
      : budget === null
        ? t("leadNoBudget")
        : t("lead", { count: result.matchingCount });

  return (
    <Page size="wide" gap="gap-[22px]">
      <div className="flex flex-col gap-[10px]">
        <Kicker>{t("kicker", { count: result.matchingCount })}</Kicker>
        <PageTitle scale="results">{t("title")}</PageTitle>
        <p className="max-w-[760px] text-lg leading-[1.45] text-stone">
          {lead}
          {result.extras.length ? ` ${t("leadExtras", { count: result.extras.length })}` : ""}
          {result.picks.length === 0 && result.extras.length === 0 ? ` ${t("leadNone")}` : ""}
        </p>
        <FilterBar chips={chips} state={state} subId={sub.id} />
        <HowWeRank note={t("eanNote")} toggle={t("howWeRank")} title={t("howTitle")} items={howItems} />
      </div>

      {relax.length ? (
        <section aria-labelledby="relax-title" className="flex flex-col gap-2">
          <h2 id="relax-title" className="text-[15px] font-bold text-lime">
            {t("relaxTitle")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {relax.map((r) => {
              const l = relaxLink(r);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="flex min-h-11 items-center rounded-full border border-lime px-[14px] text-sm font-semibold text-mist hover:bg-lime-18"
                  >
                    {l.text}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {cards.length === 0 && extraCards.length === 0 ? (
        <Panel tone="dashed" className="text-lg">
          {t("empty")}
        </Panel>
      ) : null}

      {cards.length ? (
        <section aria-label={t("picksLabel")}>
          <CardRow>
            {cards.map((c) => (
              <ResultCard key={c.productId} card={c} />
            ))}
          </CardRow>
        </section>
      ) : null}

      {result.hiddenUnknownCount > 0 ? (
        <p className="text-[15px] text-stone">
          {t("hiddenUnknown", { count: result.hiddenUnknownCount })}{" "}
          <Link
            href={href(sub!, withSetting(state, "showUnknown", true))}
            className="inline-flex min-h-11 items-center font-bold text-lime underline underline-offset-2"
          >
            {t("hiddenUnknownShow")}
          </Link>
        </p>
      ) : null}

      {notes.length ? (
        <section aria-labelledby="advice-title" className="flex flex-col gap-3">
          <SectionTitle id="advice-title">{t("worthKnowing")}</SectionTitle>
          <ul className="flex flex-col gap-3">
            {notes.map((n) => {
              const offer = n.to ? offerOf(n.to.product) : undefined;
              return (
                <li
                  key={`${n.kind}-${n.to?.product.id ?? ""}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-lime-12 px-4 py-3"
                >
                  <span className="min-w-0 flex-[1_1_320px] text-base leading-normal text-mist">
                    {noteText(n)}
                    {n.to ? (
                      <span className="block text-sm text-stone">
                        {nameOf(n.to.product)} · {formatEur(n.to.priceCents)}
                      </span>
                    ) : null}
                  </span>
                  {offer ? (
                    <a
                      href={`/go/${offer.id}${sessionId ? `?s=${sessionId}` : ""}`}
                      rel="sponsored noopener"
                      className="inline-flex min-h-11 items-center rounded-full bg-lime px-4 text-sm font-bold text-night"
                    >
                      {t("seeProduct")} — {offer.storeName}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {consider ? (
        <section aria-labelledby="consider-title" className="flex flex-col gap-3">
          <SectionTitle id="consider-title">
            {t("worthConsidering", { brand: consider.product.brand })}
          </SectionTitle>
          <p className="text-[15px] text-stone">{t("worthConsideringWhy")}</p>
          <CardRow>
            <ResultCard
              card={toCard({ ...consider, tier: null, recommended: false, overBudgetByCents: 0 })}
            />
          </CardRow>
        </section>
      ) : null}

      {extraCards.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="extras-title">
          <SectionTitle id="extras-title">{t("extrasTitle")}</SectionTitle>
          <CardRow>
            {extraCards.map((c) => (
              <ResultCard key={c.productId} card={c} />
            ))}
          </CardRow>
        </section>
      ) : null}

      {result.more.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="more-title">
          {moreCards.length ? (
            <>
              <SectionTitle id="more-title">{t("moreTitle")}</SectionTitle>
              <p className="text-base text-stone">{t("moreLead")}</p>
              <CardRow>
                {moreCards.map((c, i) => (
                  <div key={c.productId} id={`v${i}`} className="contents">
                    <ResultCard card={c} />
                  </div>
                ))}
              </CardRow>
            </>
          ) : (
            <h2 id="more-title" className="sr-only">
              {t("moreTitle")}
            </h2>
          )}
          {moreLeft > 0 ? (
            <div>
              <ButtonLink
                href={`${href(sub, state)}&vairak=${moreShown + MORE_STEP}#v${moreShown}`}
                variant="outline"
              >
                {moreShown === 0
                  ? t("moreShowFirst", { count: Math.min(MORE_STEP, moreLeft), total: moreLeft })
                  : t("moreShow", { count: Math.min(MORE_STEP, moreLeft), total: moreLeft })}
              </ButtonLink>
            </div>
          ) : null}
        </section>
      ) : null}

      {compared.length > 1 ? <CompareTable columns={columns} rows={rows} /> : null}

      {refurbCards.length ? (
        <section className="flex flex-col gap-[10px]" aria-labelledby="refurb-title">
          <h2
            id="refurb-title"
            className="flex items-center gap-[10px] font-body text-[15px] font-bold tracking-normal text-refurb-border"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            {t("refurbLabel")}
          </h2>
          {refurbCards.map((c) => (
            <ResultCard key={`r-${c.productId}`} card={c} />
          ))}
        </section>
      ) : null}

      {result.picks.length ? (
        // A radar follows one model (plus, if chosen, others that meet these answers):
        // the panel lets the shopper choose which of the picks, or all of them.
        <Panel tone="lime" className="flex flex-wrap items-center justify-between gap-x-5 gap-y-[14px]">
          <div className="min-w-0 flex-[1_1_320px]">
            <h2 className="font-heading text-[22px] font-semibold text-mist">{t("radarTitle")}</h2>
            <p className="text-base text-stone">{t("radarCtaSub")}</p>
          </div>
          <ButtonLink
            href={`/radars/jauns?choose=${result.picks.map((x) => x.product.id).join(",")}&s=${sessionId ?? ""}`}
          >
            {t("radarCta", { price: t("radarMonthly") })}
          </ButtonLink>
        </Panel>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <ButtonLink
          href={`${basePath}?a=${encodeState(state)}&q=${sub.questions.find((q) => q.stage === "flow")?.id ?? "budget"}`}
          variant="outline"
        >
          {t("changeAnswers")}
        </ButtonLink>
        <ButtonLink href="/izvelies" variant="link">
          {t("startOver")}
        </ButtonLink>
      </div>
    </Page>
  );
}

function bestIdx(vals: (number | null)[], better: (x: number, y: number) => boolean): number | null {
  let idx: number | null = null;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v === null || v === undefined) continue;
    if (idx === null || better(v, vals[idx]!)) idx = i;
  }
  if (idx === null) return null;
  const present = vals.filter((v): v is number => v !== null);
  return new Set(present).size > 1 ? idx : null;
}
