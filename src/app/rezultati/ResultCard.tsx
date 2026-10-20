import { getTranslations } from "next-intl/server";
import type { PriceLine } from "@/domain/pricing/omnibus";
import { formatEur, formatEurDelta, formatRating } from "@/i18n/format";
import { buttonClass } from "@/ui/Button";
import { SaveButton } from "@/ui/SaveButton";

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
  /** Fit-critical data the shop does not state (shown only when the user asked to see such products). */
  unknownData: string | null;
  energy: { cost10yCents: number; totalCents: number } | null;
  otherOffers: { storeName: string; priceCents: number }[];
  savingVsMaxCents: number | null;
  /** Truthful upgrade box (§2.8): what differs, or a note when the specs are known and equal. */
  upgrade: { priceDeltaCents: number; tierLabel: string; lines: string[]; note: string | null } | null;
  refurbished: {
    grade: string | null;
    warrantyMonths: number | null;
    savingVsNewCents: number | null;
  } | null;
  sessionId: string | null;
  /** In the signed-in user's wishlist (the heart is filled). */
  saved: boolean;
};

function goHref(card: CardModel): string {
  return `/go/${card.best.id}${card.sessionId ? `?s=${card.sessionId}` : ""}`;
}

/** data-ga-* attributes for the offer click (src/ui/analytics). */
function offerAnalytics(card: CardModel) {
  return {
    "data-ga-event": "select_offer",
    "data-ga-param-store": card.best.storeName,
    "data-ga-param-tier": card.tier ?? "none",
    "data-ga-param-recommended": card.recommended ? "yes" : "no",
    "data-ga-param-refurbished": card.refurbished ? "yes" : "no",
    "data-ga-param-price-eur": String(Math.round(card.best.priceCents / 100)),
  };
}

const pill = "inline-flex items-center rounded-full px-3 py-[5px] text-[13px] font-bold leading-none";

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`mt-0.5 shrink-0 ${className}`}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function BoltIcon() {
  return (
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
      className="mt-0.5 shrink-0 text-muted"
    >
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

/** Spec §3.2 result card, prototype layout: one of up to three cards in a row. */
export async function ResultCard({ card }: { card: CardModel }) {
  if (card.refurbished) return <RefurbishedCard card={card} />;
  const t = await getTranslations("results");
  const over = card.overBudgetByCents > 0;
  const tierLabel = card.tier
    ? t(`tier${card.tier[0]!.toUpperCase()}${card.tier.slice(1)}` as "tierBudget")
    : null;

  return (
    <article
      className={`flex min-w-0 max-w-full flex-[1_1_300px] flex-col gap-[14px] rounded-card bg-white sm:max-w-[560px] p-[22px] text-night ${
        over ? "border-2 border-dashed border-over-border" : ""
      } ${card.recommended ? "shadow-[0_0_0_3px_var(--color-lime)]" : ""}`}
      aria-label={card.name}
      id={`p-${card.productId}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {over ? (
            <span className={`${pill} bg-over-bg text-over-text`}>
              {t("overBudget", { amount: formatEur(card.overBudgetByCents) })}
            </span>
          ) : tierLabel ? (
            <span className={`${pill} bg-card-pill text-night`}>{tierLabel}</span>
          ) : null}
          {card.recommended ? <span className={`${pill} bg-lime text-night`}>{t("recommended")}</span> : null}
        </div>
        {card.rating !== null ? (
          <span className="whitespace-nowrap pt-[5px] text-[13px] text-muted">
            {t("rating", { score: formatRating(card.rating / 10) })}
          </span>
        ) : null}
      </div>

      <div>
        <h3 className="font-body text-xl leading-tight font-bold tracking-normal">{card.name}</h3>
        <p className="mt-1 font-heading text-[13px] font-semibold tracking-[0.01em]">
          {t("model", { code: card.modelCode, ean: card.ean ?? "—" })}
        </p>
        {card.specs ? <p className="mt-1 text-sm text-muted">{card.specs}</p> : null}
      </div>

      <div className="flex flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-[10px] gap-y-1">
          <span
            data-price-cents={card.best.priceCents}
            className="font-heading text-[38px] leading-none font-bold tracking-[-0.02em]"
          >
            {formatEur(card.best.priceCents)}
          </span>
          <span className="text-[15px] font-semibold">{card.best.storeName}</span>
          <span className="text-sm text-muted">
            {card.best.stock === "in" ? t("stockIn") : t("stockSoon")}
            {card.best.deliveryDate ? ` · ${t("delivery", { date: card.best.deliveryDate })}` : ""}
            {card.best.deliveryDays !== null
              ? ` (${t("deliveryDays", { days: card.best.deliveryDays })})`
              : ""}
          </span>
        </p>
        <p className="text-[13px] text-muted">
          {card.priceLine.kind === "lowest_now"
            ? t("lowest30Now")
            : card.priceLine.kind === "was_lower"
              ? t("lowest30Was", { amount: formatEur(card.priceLine.lowestCents) })
              : t("noHistory")}
        </p>
      </div>

      {card.upgrade ? (
        <div className="flex flex-col gap-0.5 rounded-control bg-best px-3 py-[10px]">
          <strong className="text-sm font-bold">
            {t("upgrade", {
              amount: formatEurDelta(card.upgrade.priceDeltaCents),
              tier: card.upgrade.tierLabel,
            })}
          </strong>
          <span className="text-sm leading-[1.45]">
            {card.upgrade.note ?? card.upgrade.lines.join(" · ")}
          </span>
        </div>
      ) : null}

      {card.energy ? (
        <p className="flex items-start gap-2 text-sm">
          <BoltIcon />
          <span>
            {t("energy10y", {
              energy: formatEur(card.energy.cost10yCents),
              total: formatEur(card.energy.totalCents),
            })}
          </span>
        </p>
      ) : null}

      {card.whyFits.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="sr-only">{t("whyFits")}</p>
          <ul className="flex flex-col gap-1.5 text-[15px]">
            {card.whyFits.map((w) => (
              <li key={w} className="flex gap-2">
                <CheckIcon className="text-success" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.unconfirmed.length ? (
        <p className="text-sm text-muted">{t("unconfirmed", { items: card.unconfirmed.join(", ") })}</p>
      ) : null}
      {card.unknownData !== null ? (
        <p className="text-sm font-semibold text-over-text">
          {t("unknownData", { items: card.unknownData })}
        </p>
      ) : null}

      {card.otherOffers.length ? (
        <div className="flex flex-col gap-1 border-t border-card-line pt-[10px] text-sm text-muted">
          <p className="font-semibold">{t("otherShops")}</p>
          <ul className="flex flex-col gap-1">
            {card.otherOffers.map((o) => (
              <li key={o.storeName} className="flex justify-between gap-2">
                <span>{o.storeName}</span>
                <span>{formatEur(o.priceCents)}</span>
              </li>
            ))}
          </ul>
          {card.savingVsMaxCents ? (
            <p className="font-semibold text-success">
              {t("savingVsMax", { amount: formatEur(card.savingVsMaxCents) })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-2 pt-1">
        <a
          href={goHref(card)}
          rel="sponsored noopener"
          {...offerAnalytics(card)}
          className={buttonClass({ variant: "dark", block: true })}
        >
          {t("buy", { shop: card.best.storeName })}
        </a>
        <SaveButton
          target={{ kind: "product", productId: card.productId }}
          saved={card.saved}
          name={card.name}
        />
      </div>
    </article>
  );
}

/** Spec §3.3: a refurbished offer as the prototype's blue horizontal card. */
export async function RefurbishedCard({ card }: { card: CardModel }) {
  const t = await getTranslations("results");
  const r = card.refurbished!;
  return (
    <article
      className="flex flex-wrap items-center gap-x-6 gap-y-[14px] rounded-card bg-refurb-bg px-[22px] py-5 text-night"
      aria-label={card.name}
    >
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex rounded-full bg-refurb px-[10px] py-1 text-xs font-bold text-white">
            {t("refurbBadge")}
          </span>
          {r.warrantyMonths ? (
            <span className="inline-flex rounded-full bg-white px-[10px] py-1 text-xs font-bold text-refurb-ink">
              {t("refurbWarranty", { months: r.warrantyMonths })}
            </span>
          ) : null}
        </div>
        <h3 className="font-body text-[19px] leading-tight font-bold tracking-normal">{card.name}</h3>
        <p className="font-heading text-[13px] font-semibold text-refurb-ink">
          {t("model", { code: card.modelCode, ean: card.ean ?? "—" })} · {t("refurbSameModel")}
        </p>
        {r.grade ? <p className="text-sm text-refurb-ink-2">{t("refurbGrade", { grade: r.grade })}</p> : null}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="font-heading text-[32px] leading-none font-bold">
          {formatEur(card.best.priceCents)}
        </span>
        <span className="text-sm font-semibold text-refurb-ink">
          {card.best.storeName}
          {r.savingVsNewCents ? ` · ${t("refurbSaving", { amount: formatEur(r.savingVsNewCents) })}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={goHref(card)}
          rel="sponsored noopener"
          {...offerAnalytics(card)}
          className="inline-flex min-h-12 items-center rounded-control bg-refurb px-5 font-bold text-white"
        >
          {t("view", { shop: card.best.storeName })}
        </a>
        <SaveButton
          target={{ kind: "product", productId: card.productId }}
          saved={card.saved}
          name={card.name}
          variant="icon"
        />
      </div>
    </article>
  );
}

/** Up to three cards side by side, one column on phones (prototype). */
export function CardRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-stretch gap-4">{children}</div>;
}
