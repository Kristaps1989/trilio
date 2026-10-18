import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { PriceLine } from "@/domain/pricing/omnibus";
import { formatEur, formatEurDelta, formatRating } from "@/i18n/format";

// Spec §3.2 result card and §3.3 refurbished card. Server component: all
// numbers arrive formatted, all copy comes from messages.

export type CardOffer = {
  id: string;
  storeName: string;
  priceCents: number;
  stock: "in" | "soon";
  deliveryDate: string | null;
  deliveryDays: number | null;
};

export type CardModel = {
  productId: string;
  name: string;
  modelCode: string;
  ean: string | null;
  specs: string | null;
  tier: "budget" | "mid" | "top" | null;
  recommended: boolean;
  rating: number | null;
  best: CardOffer;
  overBudgetByCents: number;
  priceLine: PriceLine;
  whyFits: string[];
  unconfirmed: string[];
  energy: { cost10yCents: number; totalCents: number } | null;
  otherOffers: { storeName: string; priceCents: number }[];
  savingVsMaxCents: number | null;
  upgrade: { priceDeltaCents: number; tierLabel: string; lines: string[]; onlyBrand: boolean } | null;
  refurbished: {
    grade: string | null;
    warrantyMonths: number | null;
    savingVsNewCents: number | null;
  } | null;
  sessionId: string | null;
  trackHref: string;
};

export async function ResultCard({ card }: { card: CardModel }) {
  const t = await getTranslations("results");
  const refurb = !!card.refurbished;
  const over = card.overBudgetByCents > 0;
  const tierLabel = card.tier
    ? t(`tier${card.tier[0]!.toUpperCase()}${card.tier.slice(1)}` as "tierBudget")
    : null;

  return (
    <article
      className={`flex flex-col gap-4 rounded-card p-[22px] ${
        refurb
          ? "border-[1.5px] border-refurb-border bg-refurb-bg text-night"
          : over
            ? "border-2 border-dashed border-over-border bg-over-bg text-night"
            : "bg-white text-night"
      } ${card.recommended ? "ring-[3px] ring-lime" : ""}`}
      aria-label={card.name}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide">
        {refurb ? (
          <span className="rounded-md bg-refurb px-2 py-1 text-white">{t("refurbLabel")}</span>
        ) : over ? (
          <span className="rounded-md bg-over-text px-2 py-1 text-white">
            {t("overBudget", { amount: formatEur(card.overBudgetByCents) })}
          </span>
        ) : tierLabel ? (
          <span className="rounded-md bg-night px-2 py-1 text-mist">{tierLabel}</span>
        ) : null}
        {card.recommended ? (
          <span className="rounded-md bg-lime px-2 py-1 text-night">{t("recommended")}</span>
        ) : null}
        {card.rating !== null ? (
          <span className="ml-auto text-muted normal-case tracking-normal">
            {t("rating", { score: formatRating(card.rating / 10) })}
          </span>
        ) : null}
      </div>

      <div>
        <h3 className="text-xl font-bold leading-tight">{card.name}</h3>
        <p className="mt-1 text-sm text-muted">
          {t("model", { code: card.modelCode, ean: card.ean ?? "—" })}
          {refurb ? ` · ${t("refurbSameModel")}` : ""}
        </p>
        {card.specs ? <p className="mt-1 text-base">{card.specs}</p> : null}
      </div>

      {card.refurbished ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-refurb">
          {card.refurbished.grade ? <li>{t("refurbGrade", { grade: card.refurbished.grade })}</li> : null}
          {card.refurbished.warrantyMonths ? (
            <li>{t("refurbWarranty", { months: card.refurbished.warrantyMonths })}</li>
          ) : null}
          {card.refurbished.savingVsNewCents ? (
            <li>{t("refurbSaving", { amount: formatEur(card.refurbished.savingVsNewCents) })}</li>
          ) : null}
        </ul>
      ) : null}

      <div>
        <p className="font-heading text-3xl font-bold">
          {formatEur(card.best.priceCents)}{" "}
          <span className="text-base font-semibold text-muted">· {card.best.storeName}</span>
        </p>
        <p className="text-sm text-muted">
          {card.best.stock === "in" ? t("stockIn") : t("stockSoon")}
          {card.best.deliveryDate ? ` · ${t("delivery", { date: card.best.deliveryDate })}` : ""}
          {card.best.deliveryDays !== null ? ` (${t("deliveryDays", { days: card.best.deliveryDays })})` : ""}
        </p>
        <p className="mt-1 text-sm font-semibold">
          {card.priceLine.kind === "lowest_now"
            ? t("lowest30Now")
            : card.priceLine.kind === "was_lower"
              ? t("lowest30Was", { amount: formatEur(card.priceLine.lowestCents) })
              : t("noHistory")}
        </p>
      </div>

      {card.upgrade ? (
        <div className="rounded-xl bg-best p-3 text-sm">
          <p className="font-semibold">
            {t("upgrade", {
              amount: formatEurDelta(card.upgrade.priceDeltaCents),
              tier: card.upgrade.tierLabel,
            })}
          </p>
          <p className="mt-1">{card.upgrade.onlyBrand ? t("onlyBrand") : card.upgrade.lines.join(" · ")}</p>
        </div>
      ) : null}

      {card.energy ? (
        <p className="text-sm">
          {t("energy10y", {
            energy: formatEur(card.energy.cost10yCents),
            total: formatEur(card.energy.totalCents),
          })}
        </p>
      ) : null}

      {card.whyFits.length ? (
        <div>
          <p className="text-sm font-semibold text-muted">{t("whyFits")}</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {card.whyFits.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.unconfirmed.length ? (
        <p className="text-sm text-muted">{t("unconfirmed", { items: card.unconfirmed.join(", ") })}</p>
      ) : null}

      {card.otherOffers.length ? (
        <div className="text-sm">
          <p className="font-semibold text-muted">{t("otherShops")}</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {card.otherOffers.map((o) => (
              <li key={o.storeName}>
                {o.storeName}: {formatEur(o.priceCents)}
              </li>
            ))}
          </ul>
          {card.savingVsMaxCents ? (
            <p className="mt-1 font-semibold">
              {t("savingVsMax", { amount: formatEur(card.savingVsMaxCents) })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          href={`/go/${card.best.id}${card.sessionId ? `?s=${card.sessionId}` : ""}`}
          rel="sponsored noopener"
          data-ga-event="select_offer"
          data-ga-param-store={card.best.storeName}
          data-ga-param-tier={card.tier ?? "none"}
          data-ga-param-recommended={card.recommended ? "yes" : "no"}
          data-ga-param-refurbished={card.refurbished ? "yes" : "no"}
          data-ga-param-price-eur={String(Math.round(card.best.priceCents / 100))}
          className="flex min-h-14 flex-1 items-center justify-center rounded-button bg-night px-6 text-lg font-bold text-mist"
        >
          {t("buy", { shop: card.best.storeName })}
        </a>
        <Link
          href={card.trackHref}
          className="flex min-h-14 flex-1 items-center justify-center rounded-button border-[1.5px] border-night px-6 text-lg font-semibold text-night"
        >
          {t("track")}
        </Link>
      </div>
    </article>
  );
}
