import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db, searchSessions } from "@/db";
import { loadCandidates } from "@/db/queries/catalog";
import type { OfferView, ProductView } from "@/domain/catalog/types";
import { deliveryDate, workingDaysUntil } from "@/domain/delivery/delivery";
import { upgradeDelta } from "@/domain/delta/delta";
import {
  ENERGY_SUBCATEGORIES,
  energyCost10yCents,
  energyPriceFromEnv,
  tcoCents,
} from "@/domain/energy/energy";
import { budgetCents, decodeState, encodeState } from "@/domain/flow/state";
import { priceLine } from "@/domain/pricing/omnibus";
import { chosenOptions, visibleQuestions } from "@/domain/questions/engine";
import { getGroupOfSubcategory, getSubcategory } from "@/domain/questions/catalog";
import type { Subcategory } from "@/domain/questions/schema";
import { rank, type Pick, type RefurbishedPick } from "@/domain/ranking/rank";
import { whyItFits } from "@/domain/ranking/score";
import {
  formatCm,
  formatDateDative,
  formatDb,
  formatEur,
  formatInt,
  formatLitres,
  formatRating,
} from "@/i18n/format";
import { PrimaryLink } from "@/ui/PrimaryButton";
import { Shell } from "@/ui/Shell";
import { CompareTable, type CompareColumn, type CompareRow } from "./CompareTable";
import { deltaLines } from "./delta-text";
import { ResultCard, type CardModel, type CardOffer } from "./ResultCard";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ sub?: string; a?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("results");
  return { title: t("title") };
}

const COUNTRY = "LV";

function cardOffer(o: OfferView, now: Date): CardOffer {
  const date = deliveryDate(o, now, COUNTRY);
  return {
    id: o.id,
    storeName: o.storeName,
    priceCents: o.priceCents,
    stock: o.stock === "soon" ? "soon" : "in",
    deliveryDate: date ? formatDateDative(date) : null,
    deliveryDays: workingDaysUntil(o),
  };
}

function unconfirmedLabels(ids: string[], sub: Subcategory): string[] {
  return ids.map((id) => sub.questions.find((q) => q.id === id)?.title ?? id);
}

export default async function ResultsPage({ searchParams }: Props) {
  const { sub: subId, a } = await searchParams;
  const sub = subId ? getSubcategory(subId) : undefined;
  const group = sub ? getGroupOfSubcategory(sub.id) : undefined;
  if (!sub || !group) notFound();

  const t = await getTranslations("results");
  const td = await getTranslations("delta");
  const ta = await getTranslations("attr");
  const state = decodeState(sub, a);
  const budget = budgetCents(state);
  const urgency = state.trailing.urgency ?? "two_weeks";
  const now = new Date();
  const energyPrice = energyPriceFromEnv();

  const products = await loadCandidates(db, sub.id);
  const result = rank({
    products,
    sub,
    answers: state.answers,
    budgetCents: budget,
    urgency,
    includeRefurbished: state.trailing.refurbished !== "no",
  });

  // Saved requirements (spec DATA_MODEL SearchSession); also the click attribution key.
  const [session] = await db
    .insert(searchSessions)
    .values({
      subcategoryId: sub.id,
      answers: { ...state.answers, $trailing: state.trailing },
      budgetCents: budget,
    })
    .returning({ id: searchSessions.id })
    .catch(() => [] as { id: string }[]);
  const sessionId = session?.id ?? null;

  const tierLabel = (tier: Pick["tier"]) =>
    t(`tier${tier[0]!.toUpperCase()}${tier.slice(1)}` as "tierBudget");
  const cheapest = result.picks[0] ?? null;
  const encoded = encodeState(state);
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

  function toCard(pick: Pick): CardModel {
    const others = otherOffers(pick.product, pick.offer);
    const upgrade =
      cheapest && pick.product.id !== cheapest.product.id
        ? (() => {
            const d = upgradeDelta(
              { product: cheapest.product, priceCents: cheapest.offer.priceCents },
              { product: pick.product, priceCents: pick.offer.priceCents },
              energyPrice,
            );
            return {
              priceDeltaCents: d.priceDeltaCents,
              tierLabel: tierLabel(cheapest.tier),
              lines: deltaLines(d.items, td),
              onlyBrand: d.onlyBrandAndDesign,
            };
          })()
        : null;
    return {
      productId: pick.product.id,
      name: pick.product.name,
      modelCode: pick.product.modelCode,
      ean: pick.product.ean,
      specs: pick.product.specs,
      tier: pick.overBudgetByCents > 0 ? null : pick.tier,
      recommended: pick.recommended,
      rating: pick.product.rating,
      best: cardOffer(pick.offer, now),
      overBudgetByCents: pick.overBudgetByCents,
      priceLine: priceLine(pick.offer.priceCents, pick.offer.lowest30dCents),
      whyFits: whyItFits(pick.reasons),
      unconfirmed: unconfirmedLabels(pick.unconfirmed, sub!),
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
      ...toCard({ ...pick, tier: "mid", recommended: false, overBudgetByCents: 0 }),
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
  const refurbCards = result.refurbished.map(toRefurbCard);

  // Answer chips: chosen option labels, each linking back to its question.
  const chips = visibleQuestions(sub, state.answers)
    .filter((q) => state.answers[q.id] !== undefined)
    .map((q) => ({
      id: q.id,
      text:
        q.type === "number"
          ? `${formatInt(state.answers[q.id] as number)} ${q.input?.unit ?? ""}`
          : chosenOptions(q, state.answers)
              .map((o) => o.label)
              .join(", "),
    }));
  if (budget !== null) chips.push({ id: "budget", text: t("rowPrice") + ` ≤ ${formatEur(budget)}` });

  // Compare table (spec §3.4).
  const compared = [...result.picks, ...result.extras];
  const columns: CompareColumn[] = compared.map((p) => ({
    name: p.product.name,
    badge:
      p.overBudgetByCents > 0
        ? t("overBudget", { amount: formatEur(p.overBudgetByCents) })
        : tierLabel(p.tier),
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
  for (const q of visibleQuestions(sub, state.answers)) {
    if (q.type === "number") continue;
    const values = compared.map((p) => {
      const hits = q.options.filter((o) => p.product.tags.includes(o.value));
      return hits.map((o) => o.table_value ?? o.label).join(", ") || ta("unknown");
    });
    if (values.every((v) => v === ta("unknown"))) continue;
    rows.push({ label: q.title, values, bestIndex: null });
  }
  const attrRows: { key: string; fmt: (v: unknown) => string; better: "min" | "max" | null }[] = [
    { key: "height_cm", fmt: (v) => formatCm(v as number), better: null },
    { key: "width_cm", fmt: (v) => formatCm(v as number), better: null },
    { key: "volume_l", fmt: (v) => formatLitres(v as number), better: "max" },
    { key: "capacity_kg", fmt: (v) => `${formatInt(v as number)} kg`, better: "max" },
    { key: "energy_class", fmt: (v) => String(v), better: null },
    { key: "noise_db", fmt: (v) => formatDb(v as number), better: "min" },
    { key: "run_min", fmt: (v) => `${formatInt(v as number)} min`, better: "max" },
    { key: "no_frost", fmt: (v) => (v ? ta("yes") : ta("no")), better: null },
    { key: "freezer", fmt: (v) => (v ? ta("yes") : ta("no")), better: null },
    { key: "mop", fmt: (v) => (v ? ta("yes") : ta("no")), better: null },
    { key: "pet_brush", fmt: (v) => (v ? ta("yes") : ta("no")), better: null },
  ];
  for (const r of attrRows) {
    const raw = compared.map((p) => p.product.attributes[r.key]);
    if (raw.every((v) => v === undefined || v === null)) continue;
    const nums = raw.map((v) => (typeof v === "number" ? v : null));
    rows.push({
      label: ta(r.key as "width_cm"),
      values: raw.map((v) => (v === undefined || v === null ? ta("unknown") : r.fmt(v))),
      bestIndex: r.better === "min" ? minIndex(nums) : r.better === "max" ? maxIndex(nums) : null,
    });
  }
  if (ENERGY_SUBCATEGORIES.has(sub.id)) {
    const costs = compared.map((p) => energyCost10yCents(p.product.kwhYear, energyPrice));
    const totals = compared.map((p) => tcoCents(p.offer.priceCents, p.product.kwhYear, energyPrice));
    if (costs.some((c) => c !== null)) {
      rows.push({
        label: t("rowEnergy10y"),
        values: costs.map((c) => (c === null ? ta("unknown") : formatEur(c))),
        bestIndex: minIndex(costs),
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

  return (
    <Shell>
      <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">{t("title")}</h1>
      <p className="mt-2 text-base text-stone">
        {budget === null ? t("leadNoBudget") : t("lead", { count: result.matchingCount })}
        {result.extras.length ? ` ${t("leadExtras", { count: result.extras.length })}` : ""}
        {result.picks.length === 0 && result.extras.length === 0 ? ` ${t("leadNone")}` : ""}
      </p>

      <section aria-label={t("answers")} className="mt-4">
        <ul className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <li key={c.id}>
              <Link
                href={`${basePath}?a=${encoded}&q=${c.id}`}
                className="flex min-h-11 items-center gap-1 rounded-full border border-mist-32 bg-white-5 px-3 text-sm font-semibold text-mist"
              >
                {c.text} <span className="text-stone">· {t("edit")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-4 text-sm text-stone">{t("eanNote")}</p>

      <details className="mt-3 rounded-[14px] border border-mist-32 bg-white-5 p-4 text-sm text-mist">
        <summary className="min-h-11 cursor-pointer list-none font-semibold">{t("howWeRank")}</summary>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-stone">
          <li>{t("howFilters")}</li>
          <li>{t("howRanking")}</li>
          <li>{t("howRecommendation")}</li>
          <li>{t("howCommission")}</li>
          <li>{t("howEnergy", { price: `${formatInt(energyPrice)} ct` })}</li>
          <li>{t("howRefurbished")}</li>
          <li>{t("howUnconfirmed")}</li>
        </ul>
      </details>

      <div className="mt-6 flex flex-col gap-4">
        {cards.map((c) => (
          <ResultCard key={c.productId} card={c} />
        ))}
      </div>

      {extraCards.length ? (
        <section className="mt-6 flex flex-col gap-4" aria-label={t("extrasTitle")}>
          <h2 className="text-xl font-bold text-mist">{t("extrasTitle")}</h2>
          {extraCards.map((c) => (
            <ResultCard key={c.productId} card={c} />
          ))}
        </section>
      ) : null}

      {compared.length > 1 ? (
        <div className="mt-6">
          <CompareTable columns={columns} rows={rows} />
        </div>
      ) : null}

      {refurbCards.length ? (
        <section className="mt-8 flex flex-col gap-4" aria-label={t("refurbTitle")}>
          <h2 className="text-xl font-bold text-mist">{t("refurbTitle")}</h2>
          {refurbCards.map((c) => (
            <ResultCard key={`r-${c.productId}`} card={c} />
          ))}
        </section>
      ) : null}

      <section className="mt-8 flex flex-col gap-3">
        <PrimaryLink href={`/radars/jauns?sub=${sub.id}&a=${encoded}&s=${sessionId ?? ""}`}>
          {t("radarCta", { price: t("radarMonthly") })}
        </PrimaryLink>
        <p className="text-center text-sm text-stone">{t("radarCtaSub")}</p>
        <div className="flex gap-3">
          <PrimaryLink
            href={`${basePath}?a=${encoded}&q=${sub.questions[0]?.id ?? "budget"}`}
            variant="secondary"
          >
            {t("changeAnswers")}
          </PrimaryLink>
          <PrimaryLink href="/izvelies" variant="secondary">
            {t("startOver")}
          </PrimaryLink>
        </div>
      </section>
    </Shell>
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
