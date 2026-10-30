import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  filterQuery,
  waitedDays,
  type Filters,
  type PartnerMark,
  type ViewCounts,
  type WorkItem,
} from "@/domain/admin/crm";
import { allSubcategories, getSubcategory } from "@/domain/questions/catalog";
import { db } from "@/db";
import { loadProducts } from "@/db/queries/catalog";
import { currentOffer } from "@/domain/wishlist/wishlist";
import { formatDateShort, formatEur } from "@/i18n/format";
import { partnerHistory, partnerNames } from "@/services/admin/crm";
import { buttonClass } from "@/ui/Button";
import { PartnerForm } from "./PartnerForm";
import { Chip, inputClass } from "./ui";

// The CRM's shared pieces (docs/CRM_PLAN.md §3): every product with its model
// code and EAN, the stage and whose turn it is, the partner mark, how long it
// has waited, and one filter bar for Uzdevumi and the three lists.

const selectClass =
  "min-h-11 w-full rounded-control border-[1.5px] border-mist/35 bg-night px-3 text-[16px] text-mist";

export async function ProductCell({ item, link = true }: { item: WorkItem; link?: boolean }) {
  const t = await getTranslations("admin.crm");
  const codes = [
    item.product.modelCode ? t("model", { code: item.product.modelCode }) : null,
    item.product.ean ? t("ean", { ean: item.product.ean }) : null,
  ].filter(Boolean);
  return (
    <span className="flex min-w-[220px] flex-col">
      {link ? (
        <Link href={item.href} className="font-semibold underline underline-offset-2">
          {item.number ? `${item.number} · ` : ""}
          {item.product.name}
        </Link>
      ) : (
        <span className="font-semibold">{item.product.name}</span>
      )}
      <span className="text-sm text-stone" data-product-codes>
        {codes.length ? codes.join(" · ") : t("noCodes")}
      </span>
      <span className="text-sm text-stone">
        {getSubcategory(item.product.subcategoryId)?.label ?? item.product.subcategoryId}
      </span>
    </span>
  );
}

export async function StageCell({ item }: { item: WorkItem }) {
  const t = await getTranslations("admin.crm");
  return (
    <span className="flex flex-col items-start gap-1">
      <Chip tone={item.state === "action" ? "warning" : "neutral"}>
        {t(`stage.${item.kind}.${item.stage}`)}
      </Chip>
      <span className="text-sm text-stone" data-state={item.state}>
        {t(`state.${item.state}`)}
      </span>
      {item.late ? <Chip tone="warning">{t("late")}</Chip> : null}
    </span>
  );
}

export async function PartnerChip({ partner }: { partner: PartnerMark | null }) {
  const t = await getTranslations("admin.crm");
  if (!partner) return <span className="text-sm text-stone">{t("partner.none")}</span>;
  const who = [partner.partner, partner.ref ? `#${partner.ref}` : null].filter(Boolean).join(" ");
  return (
    <span className="flex flex-col items-start gap-1" data-partner={partner.status}>
      <Chip
        tone={
          partner.status === "confirmed" ? "lime" : partner.status === "unavailable" ? "neutral" : "warning"
        }
      >
        {t(`partner.${partner.status}`)}
      </Chip>
      {who ? <span className="text-sm">{who}</span> : null}
      {partner.costCents !== null ? (
        <span className="text-sm text-stone">
          {t("partner.cost", { cost: formatEur(partner.costCents) })}
        </span>
      ) : null}
    </span>
  );
}

export async function WaitCell({ item, now }: { item: WorkItem; now: Date }) {
  const t = await getTranslations("admin.crm");
  const days = item.state === "done" ? null : waitedDays(item.waitingSince, now);
  return (
    <span className="flex flex-col">
      <span>{formatDateShort(item.date)}</span>
      {days !== null ? (
        <span className={`text-sm ${item.state === "action" ? "font-semibold text-warning" : "text-stone"}`}>
          {days === 0 ? t("waitToday") : t("waitDays", { days })}
        </span>
      ) : null}
    </span>
  );
}

export async function NextStepCell({ item }: { item: WorkItem }) {
  const t = await getTranslations("admin.crm");
  if (!item.next) return <span className="text-sm text-stone">—</span>;
  return (
    <Link
      href={item.href}
      className={buttonClass({ variant: item.state === "action" ? "primary" : "outline", size: "sm" })}
    >
      {t(`next.${item.next}`)}
    </Link>
  );
}

/** "Vajag rīcību 4 · Gaida partneri 2 · …": the state views with counts under the other filters. */
export async function StateViews({
  filters,
  counts,
  basePath,
}: {
  filters: Filters;
  counts: ViewCounts;
  basePath: string;
}) {
  const t = await getTranslations("admin.crm");
  const views = ["action", "partner", "waiting", "done", "all"] as const;
  return (
    <nav aria-label={t("views")}>
      <ul className="flex flex-wrap gap-2">
        {views.map((v) => {
          const active = filters.state === v;
          return (
            <li key={v}>
              <Link
                href={`${basePath}${filterQuery(filters, { state: v })}`}
                aria-current={active ? "true" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[15px] font-semibold ${
                  active ? "bg-mist text-night" : "border-[1.5px] border-line-30 text-mist"
                }`}
              >
                {t(`view.${v}`)}
                <span className={`rounded-full px-2 text-sm ${active ? "bg-night text-mist" : "bg-chip"}`}>
                  {counts[v]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** One GET form: period, state, kind, partner, category and search; the URL is the view. */
export async function FilterBar({
  filters,
  basePath,
  showKind = false,
  csvHref,
}: {
  filters: Filters;
  basePath: string;
  showKind?: boolean;
  csvHref?: string;
}) {
  const t = await getTranslations("admin.crm");
  const subs = allSubcategories().sort((a, b) => a.label.localeCompare(b.label, "lv"));
  return (
    <form
      method="get"
      action={basePath}
      role="search"
      aria-label={t("filters")}
      className="flex flex-col gap-3"
      data-crm-filters
    >
      <input type="hidden" name="state" value={filters.state} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm font-semibold text-mist">
          {t("search")}
          <input
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder={t("searchHint")}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-mist">
          {t("period")}
          <select name="range" defaultValue={filters.range} className={selectClass}>
            {(["all", "today", "yesterday", "7d", "30d", "custom"] as const).map((r) => (
              <option key={r} value={r}>
                {t(`range.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-mist">
          {t("from")}
          <input name="from" type="date" defaultValue={filters.from ?? ""} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-mist">
          {t("to")}
          <input name="to" type="date" defaultValue={filters.to ?? ""} className={inputClass} />
        </label>
        {showKind ? (
          <label className="flex flex-col gap-1 text-sm font-semibold text-mist">
            {t("kind")}
            <select name="kind" defaultValue={filters.kind} className={selectClass}>
              {(["all", "lead", "offer", "order"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-sm font-semibold text-mist">
          {t("partnerFilter")}
          <select name="partner" defaultValue={filters.partner} className={selectClass}>
            {(["all", "none", "requested", "confirmed", "unavailable"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`partnerOption.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-mist">
          {t("category")}
          <select name="sub" defaultValue={filters.sub ?? ""} className={selectClass}>
            <option value="">{t("allCategories")}</option>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold text-mist">
          {t("sort")}
          <select name="sort" defaultValue={filters.sort} className={selectClass}>
            <option value="waiting">{t("sortWaiting")}</option>
            <option value="newest">{t("sortNewest")}</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass({ variant: "primary", size: "sm" })}>
          {t("apply")}
        </button>
        <Link
          href={`${basePath}?state=${filters.state}`}
          className={buttonClass({ variant: "outline", size: "sm" })}
        >
          {t("reset")}
        </Link>
        {csvHref ? (
          <a href={csvHref} download className={buttonClass({ variant: "outline", size: "sm" })}>
            {t("csv")}
          </a>
        ) : null}
      </div>
    </form>
  );
}

export async function Pager({
  filters,
  basePath,
  total,
  shown,
  hasMore,
}: {
  filters: Filters;
  basePath: string;
  total: number;
  shown: number;
  hasMore: boolean;
}) {
  const t = await getTranslations("admin.crm");
  return (
    <div className="flex flex-wrap items-center gap-3 text-[15px] text-stone">
      <span role="status" data-crm-total>
        {t("shown", { shown, total })}
      </span>
      {filters.page > 1 ? (
        <Link
          href={`${basePath}${filterQuery(filters, { sort: filters.sort, page: filters.page - 1 })}`}
          className={buttonClass({ variant: "outline", size: "sm" })}
        >
          {t("prev")}
        </Link>
      ) : null}
      {hasMore ? (
        <Link
          href={`${basePath}${filterQuery(filters, { sort: filters.sort, page: filters.page + 1 })}`}
          className={buttonClass({ variant: "outline", size: "sm" })}
        >
          {t("more")}
        </Link>
      ) : null}
    </div>
  );
}

/** The CSV of exactly this view. */
export function csvHref(filters: Filters): string {
  return `/admin/uzdevumi/csv${filterQuery(filters, { sort: filters.sort })}`;
}

/**
 * The product block at the top of a record (docs/CRM_PLAN.md §3.3): model code
 * and EAN, today's shop price, the partner mark with its history, and the form
 * to record a request or the partner's answer.
 */
export async function RecordProduct({
  productId,
  orderId = null,
  back,
  status,
}: {
  productId: string | null;
  orderId?: string | null;
  back: string;
  /** "saved" or "error" after the partner form was sent. */
  status?: string;
}) {
  const t = await getTranslations("admin.crm");
  if (!productId) return null;
  const [product] = await loadProducts(db, [productId]);
  if (!product) return null;
  const [history, names] = await Promise.all([partnerHistory(db, productId, orderId), partnerNames(db)]);
  const best = currentOffer(product);
  const latest = history[0];
  const current: PartnerMark | null = latest
    ? {
        status: latest.status,
        partner: latest.partner,
        ref: latest.partnerOrderRef,
        costCents: latest.costCents,
        at: latest.createdAt,
      }
    : null;
  return (
    <section
      aria-label={t("product")}
      className="flex flex-col gap-3 rounded-panel-lg border-[1.5px] border-line-25 p-4 text-mist"
      data-record-product
    >
      {status === "saved" ? (
        <p role="status" className="rounded-[14px] bg-lime-12 px-3 py-2">
          {t("partnerSaved")}
        </p>
      ) : status === "error" ? (
        <p role="alert" className="rounded-[14px] bg-over-bg px-3 py-2 text-over-text">
          {t("partnerError")}
        </p>
      ) : null}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[15px] sm:grid-cols-[auto_1fr]">
        <dt className="text-stone">{t("product")}</dt>
        <dd className="font-semibold">{product.name}</dd>
        <dt className="text-stone">{t("model", { code: "" }).trim()}</dt>
        <dd data-model-code>{product.modelCode || "—"}</dd>
        <dt className="text-stone">EAN</dt>
        <dd data-ean>{product.ean ?? "—"}</dd>
        <dt className="text-stone">{t("shopNow")}</dt>
        <dd>{best ? `${formatEur(best.priceCents)} · ${best.storeName}` : t("noShop")}</dd>
        <dt className="text-stone">{t("col.partner")}</dt>
        <dd>
          <PartnerChip partner={current} />
        </dd>
      </dl>
      <PartnerForm
        productId={productId}
        orderId={orderId}
        back={back}
        names={names}
        initial={latest ? { partner: latest.partner, ref: latest.partnerOrderRef } : null}
        labels={{
          title: t("partnerTitle"),
          status: t("partnerStatus"),
          requested: t("partner.requested"),
          confirmed: t("partner.confirmed"),
          unavailable: t("partner.unavailable"),
          partner: t("partnerName"),
          ref: t("partnerRef"),
          cost: t("partnerCost"),
          note: t("partnerNote"),
          save: t("partnerSave"),
        }}
      />
      {history.length ? (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
            {t("partnerHistory")} ({history.length})
          </summary>
          <ol className="flex flex-col gap-1.5 border-l-2 border-line-25 pl-4 text-sm" data-partner-history>
            {history.map((h) => (
              <li key={h.id}>
                <span className="font-semibold">{t(`partner.${h.status}`)}</span>
                {" · "}
                {[h.partner, h.partnerOrderRef ? `#${h.partnerOrderRef}` : null].filter(Boolean).join(" ")}
                <span className="text-stone">
                  {" · "}
                  {formatDateShort(h.createdAt)} · {h.createdBy}
                </span>
                {h.note ? <span className="block text-stone">{h.note}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

/** "Nākamais solis" at the top of a record: whose turn it is and the one thing to do. */
export async function NextStepBox({ item }: { item: WorkItem | undefined }) {
  const t = await getTranslations("admin.crm");
  if (!item) return null;
  return (
    <section
      aria-label={t("nextTitle")}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-panel-lg border-[1.5px] px-4 py-3 ${
        item.state === "action" ? "border-warning" : "border-line-25"
      }`}
      data-next-step={item.next ?? "none"}
    >
      <span className="flex flex-col text-mist">
        <span className="text-sm text-stone">{t("nextTitle")}</span>
        <span className="font-semibold">{item.next ? t(`next.${item.next}`) : t("nothingNext")}</span>
        <span className="text-sm text-stone">{t(`state.${item.state}`)}</span>
      </span>
      <StageCell item={item} />
    </section>
  );
}
