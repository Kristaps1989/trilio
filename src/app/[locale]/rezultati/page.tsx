import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db, searchSessions } from "@/db";
import { dailyLowest, loadCandidates } from "@/db/queries/catalog";
import { adviceNotes, DEFAULT_COSTS, type AdviceNote } from "@/domain/advice/advice";
import { subcategoryAttrs } from "@/domain/catalog/attributes";
import { canonicalBrand, displayName, shortName } from "@/domain/catalog/naming";
import type { OfferView, ProductView } from "@/domain/catalog/types";
import { deliveryDate, urgencyDate, workingDaysUntil } from "@/domain/delivery/delivery";
import { upgradeDelta } from "@/domain/delta/delta";
import {
  ENERGY_SUBCATEGORIES,
  energyCost10yCents,
  energyPriceFromEnv,
  tcoCents,
} from "@/domain/energy/energy";
import {
  argumentTargets,
  assignRoles,
  catchFor,
  coverage,
  priceConfidence,
  priorityTarget,
  reviewSummary,
  bucketOption,
  verdictsFor,
  whyNot,
} from "@/domain/confidence/confidence";
import { decidingAttrs, glossaryLine, knowledgeOf, watchOutFor } from "@/domain/knowledge/knowledge";
import { withinBudget } from "@/domain/ranking/filters";
import { optionCounts, priceStats } from "@/domain/flow/insight";
import {
  budgetCents,
  decodeState,
  encodeState,
  priceRange,
  withAnswer,
  withoutAnswer,
  withSetting,
  type FlowState,
} from "@/domain/flow/state";
import { priceLine } from "@/domain/pricing/omnibus";
import { chosenOptions, isRangeAnswer, visibleQuestions } from "@/domain/questions/engine";
import { getGroupOfSubcategory, getSubcategory } from "@/domain/questions/catalog";
import type { Answers, Question, Subcategory } from "@/domain/questions/schema";
import { brandTable, gradeOf, ungradedSubcategory, worthConsidering } from "@/domain/ranking/consider";
import { candidatePool, rank, type Pick, type RefurbishedPick } from "@/domain/ranking/rank";
import { relaxations, type Relaxation } from "@/domain/ranking/relax";
import { whyItFits } from "@/domain/ranking/score";
import {
  formatDateDative,
  formatDayLocative,
  formatEur,
  formatInt,
  formatNumber,
  formatPlain,
} from "@/i18n/format";
import { currentMarket } from "@/i18n/market";
import { ButtonLink } from "@/ui/Button";
import { Kicker, Page, PageTitle, Panel, SectionTitle } from "@/ui/layout";
import { SaveButton } from "@/ui/SaveButton";
import { savedKeys } from "@/db/queries/wishlist";
import { productKey, searchKey } from "@/domain/wishlist/wishlist";
import { currentUserId } from "@/auth";
import { betterDirection, enumLabels, formatAttr } from "./attr-format";
import { CompareTable, type CompareColumn, type CompareRow } from "./CompareTable";
import { deltaLines } from "./delta-text";
import { ConfidenceQuestion } from "./ConfidenceQuestion";
import {
  catchText,
  factLines,
  sharedLines,
  priceNoteText,
  roleLabel,
  verdictText,
  whyNotText,
  type TextContext,
} from "./confidence-text";
import { FilterBar, type Chip } from "./FilterBar";
import { HowWeRank } from "./HowWeRank";
import { cardMedia } from "./card-media";
import { CardRow, ResultCard, type CardModel, type CardOffer } from "./ResultCard";
import { activeLocale } from "@/i18n/active";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ sub?: string; a?: string; vairak?: string }> };

/** Deeper facts shown in the compare table when a product states them (docs/CONFIDENCE_PLAN.md C2, C3). */
const DETAIL_ROWS = [
  "programme_min",
  "quick_wash_min",
  "water_l_cycle",
  "moisture_pct",
  "condensation_cls",
  "inverter",
  "door_reversible",
  "fast_freeze",
  "water_dispenser",
  "auto_dose",
  "delay_start",
  "child_lock",
  "half_load",
  "suction_pa",
  "bin_l",
  "mapping",
  "self_empty",
  "cleaning_program",
  "cup_height_cm",
  "auto_off",
  "dual_basket",
  "dishwasher_safe",
  "window",
  "noise_class",
  "repairability",
  "warranty_months",
  "model_year",
];

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
  const sub = subId ? getSubcategory(subId, activeLocale()) : undefined;
  const group = sub ? getGroupOfSubcategory(sub.id, activeLocale()) : undefined;
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
  const nameOf = (p: ProductView) => displayName(p.name, p.brand, sub.id, typeLabel, p.modelCode);

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

  // Hearts: which of these products, and whether this very search, are in the wishlist.
  const answersParam = encodeState(state);
  const saved = await savedKeys(db, await currentUserId(), [
    searchKey(sub.id, answersParam),
    ...products.map((p) => productKey(p.id)),
  ]);

  const cheapest = result.picks[0] ?? null;

  // Three options a shopper can trust (docs/CONFIDENCE_PLAN.md): why each pick is
  // here, a verdict in the shopper's terms, its catch, and what was rejected.
  const lang = activeLocale();
  const know = knowledgeOf(sub.id);
  const decides = decidingAttrs(sub.id);
  enums.mapping = {
    lidar: ta("mapping_lidar"),
    camera: ta("mapping_camera"),
    gyro: ta("mapping_gyro"),
  };
  const inBudgetPool = candidatePool(input).filter((c) => withinBudget(c.price, budget));
  const priority = priorityTarget(sub, state.answers);
  const targets = argumentTargets(sub, state.answers, decides);
  const roleTarget = priority?.target ?? targets[0] ?? null;
  const roleTargetLabel = priority
    ? priority.label.toLowerCase()
    : roleTarget
      ? attrLabel(roleTarget.attr).toLowerCase()
      : "";
  const pickCands = result.picks.map((p) => ({ ...p, price: p.offer.priceCents }));
  const roles = assignRoles(pickCands, inBudgetPool, sub, roleTarget, decides);
  const roleNames = (id: string) => (roles.get(id) ?? []).map((r) => roleLabel(r, roleTargetLabel, t));
  const histories = await dailyLowest(
    db,
    result.picks.map((p) => p.product.id),
  );
  const graded = brandTable.reviewed && !ungradedSubcategory(brandTable, sub.id);
  const featureName = (key: string) =>
    td.has(`feature.${key}` as "feature.no_frost")
      ? td(`feature.${key}` as "feature.no_frost")
      : attrLabel(key).toLowerCase();
  const textCtx: TextContext = {
    t: (key, values) => t(key as "title", values as Record<string, string>),
    attrLabel,
    attrValue: (key, value) => formatAttr(key, value, (k) => ta(k as "yes"), enums),
    featureName,
    answerPhrase: (questionId) => know.answerPhrases[questionId]?.[lang] ?? null,
    nameOf: (id) => {
      const p = products.find((x) => x.id === id);
      return p ? nameOf(p) : id;
    },
    shortNameOf: (id) => {
      const p = products.find((x) => x.id === id);
      return p ? shortName(p.name, p.brand, p.modelCode) : id;
    },
  };
  const verdicts = verdictsFor(
    {
      sub,
      answers: state.answers,
      picks: pickCands,
      pool: inBudgetPool,
      targets,
      decides,
      roles: [],
      energyPriceCentsPerKwh: energyPrice,
      answerPhrases: know.answerPhrases,
    },
    (id) => roles.get(id) ?? [],
  );
  // A size line says the size the product really is, not the bucket the shopper tapped (TRUST_POLISH_PLAN §2).
  const sizedReasons = (pick: Pick) =>
    pick.reasons.map((r) => {
      const q = sub.questions.find((x) => x.id === r.questionId);
      const bucket = q ? bucketOption(q, pick.product) : null;
      const sameAttr = r.option.match?.some((m) => m.attr === bucket?.attr);
      return bucket && sameAttr && bucket.option.card_reason ? { ...r, option: bucket.option } : r;
    });
  const firstRole = (id: string | undefined) => (id ? roleNames(id)[0] : undefined);
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
    const sharedBrand = verdicts.sharedBrand?.brand.toLowerCase() === pick.product.brand.toLowerCase();
    return (pick.quality?.brand ?? 0) >= 8 && grade !== null && !sharedBrand
      ? [t("brandReliable", { grade })]
      : [];
  };

  function toCard(pick: Pick, story = false): CardModel {
    const others = otherOffers(pick.product, pick.offer);
    let upgrade: CardModel["upgrade"] = null;
    if (cheapest && pick.product.id !== cheapest.product.id) {
      const d = upgradeDelta(
        { product: cheapest.product, priceCents: cheapest.offer.priceCents, reasons: cheapest.reasons },
        { product: pick.product, priceCents: pick.offer.priceCents, reasons: pick.reasons },
        energyPrice,
        sub!.compare,
        sub!.id,
      );
      // §2.8: say nothing rather than guess when the specs are not known on both sides.
      if (d.status !== "unknown") {
        const lines = (items: typeof d.items) => deltaLines(items, td, attrLabel, enumLabel);
        upgrade = {
          priceDeltaCents: d.priceDeltaCents,
          tierLabel: firstRole(cheapest.product.id) ?? t("cheapestOption"),
          gains: lines(d.gains),
          other: lines(d.other),
          tradeoffs: lines(d.tradeoffs),
          note:
            d.status === "same"
              ? d.brandsDiffer
                ? t("onlyBrand")
                : t("sameSpecs")
              : d.gains.length === 0
                ? t("upgradeNoGain")
                : null,
        };
      }
    }
    const cand = { ...pick, price: pick.offer.priceCents };
    const pickRoles = story ? (roles.get(pick.product.id) ?? []) : [];
    const parts = story ? verdicts.byId.get(pick.product.id) : undefined;
    const verdict = parts ? verdictText(parts, textCtx) : null;
    const ungraded = graded && gradeOf(brandTable, pick.product.brand, sub!.id) === null;
    const flaw = story ? catchFor(cand, inBudgetPool, targets) : null;
    const confidence = story
      ? priceConfidence(pick.product, pick.offer.priceCents, histories.get(pick.product.id) ?? [], now)
      : null;
    return {
      productId: pick.product.id,
      roles: pickRoles.map((r) => roleLabel(r, roleTargetLabel, t)),
      roleIds: pickRoles,
      verdict,
      catchText: flaw ? catchText(flaw, textCtx) : null,
      priceNote: confidence ? priceNoteText(confidence, pick.offer.priceCents, t) : null,
      facts: factLines(pick.product, reviewSummary(pick.product), t),
      caveats: ungraded ? [t("factUngraded")] : [],
      name: nameOf(pick.product),
      modelCode: pick.product.modelCode,
      ean: pick.product.ean,
      specs: specsOf(pick.product),
      tier: pick.overBudgetByCents > 0 ? null : pick.tier,
      recommended: pick.recommended,
      best: cardOffer(pick.offer, now),
      overBudgetByCents: pick.overBudgetByCents,
      priceLine: priceLine(pick.offer.priceCents, pick.offer.lowest30dCents),
      whyFits: [...brandLine(pick), ...whyItFits(sizedReasons(pick))].slice(0, 3),
      unconfirmed: pick.fitUnknown ? [] : pick.unconfirmed.map((k) => attrLabel(k).toLowerCase()),
      unknownData: pick.fitUnknown ? unknownText(pick.unconfirmed) : null,
      energy: energyFor(pick.product, pick.offer.priceCents),
      otherOffers: others.list,
      savingVsMaxCents: others.savingVsMaxCents,
      upgrade,
      refurbished: null,
      sessionId,
      saved: saved.has(productKey(pick.product.id)),
      score: pick.score,
      ...cardMedia(pick.product),
    };
  }

  function toRefurbCard(pick: RefurbishedPick): CardModel {
    const others = otherOffers(pick.product, pick.offer);
    return {
      ...toCard({
        ...pick,
        price: pick.offer.priceCents,
        tier: null,
        recommended: false,
        overBudgetByCents: 0,
        fitUnknown: false,
      }),
      facts: [],
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

  const storyCards = result.picks.map((p) => toCard(p, true));
  // What every card would say alike is said once, above them (TRUST_POLISH_PLAN §2).
  const shared = sharedLines(storyCards);
  const cards = storyCards.map((c, i) => ({
    ...c,
    whyFits: c.whyFits.filter((l) => !shared.includes(l)),
    facts: c.facts.filter((l) => !shared.includes(l)),
    historyNote: i === 0 || storyCards.slice(0, i).every((x) => x.priceLine.kind !== "no_history"),
  }));
  const sharedBrandLine = verdicts.sharedBrand
    ? t("sharedBrand", {
        count: verdicts.sharedBrand.count,
        total: storyCards.length,
        brand: canonicalBrand(verdicts.sharedBrand.brand),
        grade: verdicts.sharedBrand.grade,
      })
    : null;
  const extraCards = result.extras.map((p) => toCard(p));
  // Everything else in range, best value first, on request (the shopper decides how far to look).
  const moreShown = Math.min(result.more.length, Math.max(0, Math.floor(Number(vairak) || 0)));
  const moreCards = result.more.slice(0, moreShown).map((c) => ({
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
  // The category's common regrets, when the data confirms one for this pick (§3 C4); two notes at most.
  const regrets = focus
    ? watchOutFor(focus.product, sub.id, lang).slice(0, Math.max(0, 2 - notes.length))
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

  // Relax suggestions (§4.2) when fewer than three fit. Fewer picks because the rest are
  // pricier but not better (docs/UPGRADE_REASONS_PLAN.md) is not a reason to loosen anything.
  const relax: Relaxation[] = result.matchingCount < 3 ? relaxations(input) : [];
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
                  value: formatPlain(r.max),
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
            : t("rangeUpTo", { label, value: formatPlain(max), unit: r.unit }),
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

  // Compare table (spec §3.4) over the category's own attributes, in groups (docs/CONFIDENCE_PLAN.md C3).
  const compared = [...result.picks, ...result.extras];
  const columns: CompareColumn[] = compared.map((p) => ({
    name: nameOf(p.product),
    badge:
      p.overBudgetByCents > 0
        ? t("overBudget", { amount: formatEur(p.overBudgetByCents) })
        : (firstRole(p.product.id) ?? null),
  }));
  const rows: CompareRow[] = [];
  const minIndex = (vals: (number | null)[]) => bestIdx(vals, (x, y) => x < y);
  const maxIndex = (vals: (number | null)[]) => bestIdx(vals, (x, y) => x > y);
  const SIZE = new Set(["height_cm", "width_cm", "depth_cm", "cup_height_cm"]);
  const TRUST = new Set(["warranty_months", "model_year", "repairability"]);
  const groupOf = (key: string) =>
    SIZE.has(key) ? t("groupSize") : TRUST.has(key) ? t("groupTrust") : t("groupDaily");
  const modelRows: CompareRow[] = [
    {
      label: t("rowPrice"),
      group: t("groupModel"),
      values: compared.map((p) => `${formatEur(p.offer.priceCents)} · ${p.offer.storeName}`),
      bestIndex: minIndex(compared.map((p) => p.offer.priceCents)),
      alwaysShow: true,
    },
    {
      label: t("rowAvailability"),
      group: t("groupModel"),
      values: compared.map((p) => (p.offer.stock === "in" ? t("stockIn") : t("stockSoon"))),
      bestIndex: null,
    },
    {
      label: t("rowModel"),
      group: t("groupModel"),
      values: compared.map((p) => `${p.product.modelCode} · ${p.product.ean ?? "—"}`),
      bestIndex: null,
      alwaysShow: true,
    },
  ];
  // The category's compare rows, then what decides satisfaction and the deeper facts (rows unknown for all are left out).
  const subKeys = new Set(subcategoryAttrs(sub.id)?.key ?? []);
  const keys = [...new Set([...sub.compare, ...decides, ...DETAIL_ROWS.filter((k) => subKeys.has(k))])];
  const attrRows: CompareRow[] = [];
  for (const key of keys) {
    const raw = compared.map((p) => p.product.attributes[key]);
    if (raw.every((v) => v === undefined || v === null)) continue;
    const nums = raw.map((v) => (typeof v === "number" ? v : null));
    const dir = key === "model_year" ? "max" : betterDirection(key);
    attrRows.push({
      label: attrLabel(key),
      group: groupOf(key),
      hint: glossaryLine(key, lang),
      values: raw.map((v) => formatAttr(key, v, (k) => ta(k as "yes"), enums)),
      bestIndex: dir === "min" ? minIndex(nums) : dir === "max" ? maxIndex(nums) : null,
    });
  }
  const costRows: CompareRow[] = [];
  if (ENERGY_SUBCATEGORIES.has(sub.id)) {
    const costsRow = compared.map((p) => energyCost10yCents(p.product.kwhYear, energyPrice));
    const totals = compared.map((p) => tcoCents(p.offer.priceCents, p.product.kwhYear, energyPrice));
    if (costsRow.some((c) => c !== null)) {
      costRows.push({
        label: t("rowEnergy10y"),
        group: t("groupCost"),
        values: costsRow.map((c) => (c === null ? ta("unknown") : formatEur(c))),
        bestIndex: minIndex(costsRow),
      });
      costRows.push({
        label: t("rowTco"),
        group: t("groupCost"),
        values: totals.map((c) => (c === null ? ta("unknown") : formatEur(c))),
        bestIndex: minIndex(totals),
      });
    }
  }
  const trustRows: CompareRow[] = [];
  if (graded) {
    const grades = compared.map((p) => gradeOf(brandTable, p.product.brand, sub.id));
    trustRows.push({
      label: t("rowReliability"),
      group: t("groupTrust"),
      values: grades.map((g) => (g === null ? ta("unknown") : t("reliabilityValue", { grade: g }))),
      bestIndex: maxIndex(grades),
    });
  }
  const reviews = compared.map((p) => reviewSummary(p.product));
  if (reviews.some(Boolean)) {
    trustRows.push({
      label: t("rowReviews"),
      group: t("groupTrust"),
      values: reviews.map((r) =>
        r
          ? t("factReviews", { score: formatNumber(r.x10 / 10, 1), count: r.count, shops: r.shops })
          : ta("unknown"),
      ),
      bestIndex: maxIndex(reviews.map((r) => r?.x10 ?? null)),
    });
  }
  const groupOrder = [t("groupModel"), t("groupDaily"), t("groupSize"), t("groupCost"), t("groupTrust")];
  rows.push(
    ...[...modelRows, ...attrRows, ...costRows, ...trustRows].sort(
      (a, b) => groupOrder.indexOf(a.group!) - groupOrder.indexOf(b.group!),
    ),
  );

  const excluded = Object.entries(result.excludedBy)
    .filter(([, n]) => n > 0)
    .map(([id, count]) =>
      t("excludedItem", {
        label: id === "$brands" ? t("brandsChip") : (sub.questions.find((q) => q.id === id)?.title ?? id),
        count,
      }),
    );
  // The panel tells this search's story with its own numbers (§3 A7).
  const cov = coverage(products, urgency);
  const matchedAnswers = candidatePool({ ...input, showUnknown: true }).length;
  const howItems = [
    t("howStep1", { products: cov.products, shops: cov.shops }),
    t("howStep2", { count: matchedAnswers }),
    t("howStep3", { count: result.matchingCount }),
    t("howStep4"),
    t("howFilters"),
    t("howRanking"),
    t("howRecommendation"),
    t("howCommission"),
    t("howEnergy", { price: `${formatInt(energyPrice)} ct` }),
    t("howAdvice", { energy: `${formatInt(energyPrice)} ct`, water: formatEur(costs.waterCentsPerM3) }),
    t("howRefurbished"),
    t("howUnconfirmed"),
    t("howReviews"),
    ...(excluded.length ? [t("howExcluded", { items: excluded.join("; ") })] : []),
  ];

  const mid = result.picks.length ? result.picks[Math.floor(result.picks.length / 2)]!.offer.priceCents : 0;
  const lead =
    result.picks.length >= 2 && !result.tiersMeaningful
      ? t("leadSimilar", { amount: formatEur(Math.round(mid / 1000) * 1000) })
      : budget === null
        ? t("leadNoBudget")
        : t("lead", { count: result.matchingCount });

  // Coverage line (§3 A1): how much was looked at, and when.
  const rigaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/Riga" });
  const updated = cov.updatedAt
    ? t("coverageUpdated", {
        when:
          rigaDay(cov.updatedAt) === rigaDay(now)
            ? t("coverageToday", {
                time: new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "lv-LV", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Europe/Riga",
                }).format(cov.updatedAt),
              })
            : formatDayLocative(cov.updatedAt),
      })
    : "";
  const coverageLine =
    cov.products > 0
      ? `${t("coverage", { products: cov.products, shops: cov.shops, updated, matching: result.matchingCount })}${
          result.picks.length ? ` ${t("coverageClose")}` : ""
        }`
      : null;
  // One product earned both the value and the priority role: say so (§2 rule 2).
  const sensibleId = [...roles.entries()].find(([, v]) => v.includes("sensible"))?.[0];
  const oneWinner =
    !!priority &&
    !!sensibleId &&
    (roles.get(sensibleId) ?? []).includes("priority") &&
    result.picks.length > 1;

  // Priorities in plain sight (§3 A6): one tap re-ranks with the same URL state.
  const prioritiesQ = sub.questions.find((q) => q.id === "priorities");
  const activePriority = (() => {
    const a = state.answers.priorities;
    return Array.isArray(a) ? a[0] : typeof a === "string" ? a : undefined;
  })();

  // "Kāpēc ne šie?" (§3 A4).
  const whyNots = whyNot({
    products,
    sub,
    answers: state.answers,
    budget,
    urgency,
    picks: pickCands,
    scored: candidatePool({ ...input, showUnknown: true }),
    decides,
  });

  // What a saved search is called in the wishlist: the subcategory and the answers that narrow it.
  const flowIds = new Set(sub.questions.filter((q) => q.stage === "flow").map((q) => q.id));
  const searchLabel = [
    sub.label,
    ...chips.filter((c) => c.active && (flowIds.has(c.id) || c.id === "budget")).map((c) => c.label),
  ].join(" · ");
  const saveSearch = (variant: "inline" | "card") => (
    <SaveButton
      target={{ kind: "search", subcategoryId: sub.id, answersParam, label: searchLabel }}
      saved={saved.has(searchKey(sub.id, answersParam))}
      name={searchLabel}
      variant={variant}
    />
  );

  return (
    <Page size="wide" gap="gap-[22px]">
      <div className="flex flex-col gap-[10px]">
        <Kicker>{t("kicker", { count: result.matchingCount })}</Kicker>
        <PageTitle scale="results">{t("title")}</PageTitle>
        {coverageLine ? (
          <p className="max-w-[760px] text-base font-semibold text-mist" data-coverage>
            {coverageLine}
          </p>
        ) : null}
        <p className="max-w-[760px] text-lg leading-[1.45] text-stone">
          {lead}
          {result.extras.length ? ` ${t("leadExtras", { count: result.extras.length })}` : ""}
          {result.picks.length > 0 && result.picks.length < 3 && result.matchingCount > result.picks.length
            ? ` ${t("leadDominated", { count: result.picks.length })}`
            : ""}
          {result.picks.length === 0 && result.extras.length === 0 ? ` ${t("leadNone")}` : ""}
          {oneWinner ? ` ${t("oneWinner")}` : ""}
        </p>
        {prioritiesQ && result.picks.length ? (
          <nav aria-labelledby="priorities-title" className="flex flex-col gap-2">
            <h2 id="priorities-title" className="text-[15px] font-bold text-mist">
              {t("prioritiesTitle")}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {[
                ...prioritiesQ.options.map((o) => ({
                  value: o.value,
                  label: o.label,
                  href: href(sub, withAnswer(state, prioritiesQ.id, [o.value])),
                })),
                {
                  value: "",
                  label: t("prioritiesAny"),
                  href: href(sub, withoutAnswer(state, prioritiesQ.id)),
                },
              ].map((o) => {
                const active = (activePriority ?? "") === o.value;
                return (
                  <li key={o.value || "any"}>
                    <Link
                      href={o.href}
                      aria-current={active ? "true" : undefined}
                      data-ga-event="priority_tapped"
                      data-ga-param-priority={o.value || "any"}
                      className={`flex min-h-11 items-center rounded-full px-[14px] text-sm font-semibold ${
                        active ? "bg-lime text-night" : "border border-line-30 text-mist hover:bg-lime-18"
                      }`}
                    >
                      {o.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
        <FilterBar chips={chips} state={state} subId={sub.id} />
        <div>{saveSearch("inline")}</div>
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
        <section aria-labelledby="picks-title">
          {/* A heading for every region, so heading navigation finds the picks (plan §7, item 8). */}
          <h2 id="picks-title" className="sr-only">
            {t("picksLabel")}
          </h2>
          {sharedBrandLine || shared.length ? (
            <div className="mb-3 flex flex-col gap-1 text-[15px] text-mist" data-shared-facts>
              {sharedBrandLine ? <p>{sharedBrandLine}</p> : null}
              {shared.length ? (
                <p>{t("sharedFacts", { total: storyCards.length, facts: shared.join(" · ") })}</p>
              ) : null}
            </div>
          ) : null}
          <CardRow>
            {cards.map((c) => (
              <ResultCard key={c.productId} card={c} />
            ))}
          </CardRow>
        </section>
      ) : null}

      {whyNots.length ? (
        <details className="rounded-panel border-[1.5px] border-line-25 px-5 py-4" data-why-not>
          <summary
            className="flex min-h-11 cursor-pointer items-center font-heading text-lg font-semibold text-mist"
            data-ga-event="why_not_opened"
          >
            {t("whyNotTitle")}
          </summary>
          <p className="mt-1 text-[15px] text-stone">{t("whyNotLead")}</p>
          <ul className="mt-3 flex flex-col divide-y divide-line-25">
            {whyNots.map((w) => (
              <li
                key={w.product.id}
                className="flex flex-col gap-1 py-3 text-[15px] first:pt-0 last:pb-0"
                data-why-not-item={w.reason.kind}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-mist" lang="lv" data-why-not-name>
                    {nameOf(w.product)}
                  </span>
                  <span className="shrink-0 font-semibold text-mist tabular-nums">
                    {formatEur(w.priceCents)}
                  </span>
                </span>
                <span className="text-stone" data-why-not-reason>
                  {whyNotText(w, textCtx)}
                </span>
              </li>
            ))}
          </ul>
        </details>
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

      {notes.length || regrets.length ? (
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
                        <span lang="lv">{nameOf(n.to.product)}</span> · {formatEur(n.to.priceCents)}
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
            {regrets.map((r) => (
              <li
                key={r}
                className="rounded-control bg-lime-12 px-4 py-3 text-base leading-normal text-mist"
                data-regret
              >
                {r}
              </li>
            ))}
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
        // The wishlist pitch (owner, 20 Oct 2026): saving is free; e-mails are the paid extra.
        <Panel tone="lime" className="flex flex-wrap items-center justify-between gap-x-5 gap-y-[14px]">
          <div className="min-w-0 flex-[1_1_320px]">
            <h2 className="font-heading text-[22px] font-semibold text-mist">{t("saveTitle")}</h2>
            <p className="text-base text-stone">{t("saveSub", { price: t("radarMonthly") })}</p>
          </div>
          {saveSearch("inline")}
        </Panel>
      ) : null}

      {result.picks.length ? (
        <ConfidenceQuestion
          subcategoryId={sub.id}
          sessionId={sessionId}
          labels={{
            question: t("confidenceQ"),
            yes: t("confidenceYes"),
            no: t("confidenceNo"),
            note: t("confidenceNote"),
            send: t("confidenceSend"),
            thanks: t("confidenceThanks"),
          }}
        />
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
