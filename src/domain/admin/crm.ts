import { rigaDay } from "@/domain/analytics/visits";
import type { OfferStatus, OrderStatus } from "@/domain/offers/offers";

// The admin as a CRM (docs/CRM_PLAN.md): leads (products people asked to hear
// about), offers and orders as one list of work items, each with its stage,
// whose turn it is, and the one next step. No time limits (owner, 30 Oct
// 2026): an item needs attention as soon as the next step is Trilio's, and the
// list sorts the longest-waiting first. Pure: the services feed it facts.

export type WorkKind = "lead" | "offer" | "order";

/** Whose turn: Trilio's ("action"), the shopper's or the carrier's ("waiting"), a partner's, or nobody's. */
export type WorkState = "action" | "waiting" | "partner" | "done";

export type PartnerStatus = "requested" | "confirmed" | "unavailable";

export type PartnerMark = {
  status: PartnerStatus;
  partner: string | null;
  /** The partner's own order number, e.g. "48213". */
  ref: string | null;
  costCents: number | null;
  at: Date;
};

export type NextStep =
  | "request_partner"
  | "record_answer"
  | "make_offer"
  | "send_offer"
  | "pack"
  | "ship"
  | "check_parcel"
  | "contact_buyer"
  | "refund"
  | "resolve_problem";

export type Classified = {
  stage: string;
  state: WorkState;
  next: NextStep | null;
  waitingSince: Date | null;
};

export type LeadFacts = {
  firstSavedAt: Date;
  lastSavedAt: Date;
  openOffers: number;
  paidOffers: number;
  lastOfferAt: Date | null;
  partner: PartnerMark | null;
};

/** A product people asked to hear about. */
export function classifyLead(f: LeadFacts): Classified {
  if (f.openOffers > 0)
    return { stage: "offered", state: "waiting", next: null, waitingSince: f.lastOfferAt };
  // Saved again after the last offer: a new lead on the same product.
  const newSince = f.lastOfferAt && f.lastSavedAt > f.lastOfferAt ? f.lastSavedAt : null;
  if (f.paidOffers > 0 && !newSince) return { stage: "won", state: "done", next: null, waitingSince: null };
  const p = f.partner;
  if (p?.status === "requested")
    return { stage: "requested", state: "partner", next: "record_answer", waitingSince: p.at };
  if (p?.status === "unavailable")
    return { stage: "unavailable", state: "done", next: null, waitingSince: null };
  if (p?.status === "confirmed")
    return { stage: "confirmed", state: "action", next: "make_offer", waitingSince: newSince ?? p.at };
  return {
    stage: "new",
    state: "action",
    next: "request_partner",
    waitingSince: newSince ?? (f.lastOfferAt ? f.lastSavedAt : f.firstSavedAt),
  };
}

export type OfferFacts = {
  status: OfferStatus;
  createdAt: Date;
  sentAt: Date | null;
  openedAt: Date | null;
  acceptedAt: Date | null;
  partner: PartnerMark | null;
};

export function classifyOffer(f: OfferFacts): Classified {
  switch (f.status) {
    case "draft":
      // A draft waiting for the partner's confirmation is the partner's turn.
      return f.partner?.status === "requested"
        ? { stage: "draft", state: "partner", next: "record_answer", waitingSince: f.partner.at }
        : { stage: "draft", state: "action", next: "send_offer", waitingSince: f.createdAt };
    case "sent":
      return { stage: "sent", state: "waiting", next: null, waitingSince: f.sentAt ?? f.createdAt };
    case "opened":
      return { stage: "opened", state: "waiting", next: null, waitingSince: f.openedAt ?? f.sentAt };
    case "accepted":
      return { stage: "accepted", state: "waiting", next: null, waitingSince: f.acceptedAt };
    default:
      return { stage: f.status, state: "done", next: null, waitingSince: null };
  }
}

export type OrderFacts = {
  status: OrderStatus;
  createdAt: Date;
  paidAt: Date | null;
  packedAt: Date | null;
  shippedAt: Date | null;
  returnRequestedAt: Date | null;
  returnedAt: Date | null;
  late: boolean;
  /** "Ir problēma" from the buyer, not yet resolved. */
  problemSince: Date | null;
  partner: PartnerMark | null;
};

export function classifyOrder(f: OrderFacts): Classified {
  if (f.problemSince && !["refunded", "cancelled"].includes(f.status))
    return { stage: f.status, state: "action", next: "resolve_problem", waitingSince: f.problemSince };
  switch (f.status) {
    case "awaiting_payment":
      return { stage: f.status, state: "waiting", next: null, waitingSince: f.createdAt };
    case "paid":
      // Ordered from the partner and not here yet: the partner's turn.
      return f.partner?.status === "requested"
        ? { stage: f.status, state: "partner", next: "record_answer", waitingSince: f.partner.at }
        : { stage: f.status, state: "action", next: "pack", waitingSince: f.paidAt ?? f.createdAt };
    case "packed":
      return { stage: f.status, state: "action", next: "ship", waitingSince: f.packedAt ?? f.paidAt };
    case "shipped":
      return f.late
        ? { stage: f.status, state: "action", next: "check_parcel", waitingSince: f.shippedAt }
        : { stage: f.status, state: "waiting", next: null, waitingSince: f.shippedAt };
    case "return_requested":
      return { stage: f.status, state: "action", next: "contact_buyer", waitingSince: f.returnRequestedAt };
    case "returned":
      return { stage: f.status, state: "action", next: "refund", waitingSince: f.returnedAt };
    default:
      return { stage: f.status, state: "done", next: null, waitingSince: null };
  }
}

export type WorkItem = Classified & {
  kind: WorkKind;
  /** Product id for a lead, offer id, order id. */
  id: string;
  href: string;
  /** Order number ("T-2026-0001"), when there is one. */
  number: string | null;
  product: {
    id: string | null;
    name: string;
    modelCode: string | null;
    ean: string | null;
    subcategoryId: string;
  };
  /** E-mail or buyer name; for a lead, the number of savers is in `savers`. */
  person: string | null;
  /** The item's own date: last save, offer created, order placed. */
  date: Date;
  amountCents: number | null;
  partner: PartnerMark | null;
  late?: boolean;
  savers?: { total: number; optedIn: number; offered: number; bought: number };
  /** Extra text the search should find (phone, buyer name, company). */
  searchText?: string;
};

// ---------------------------------------------------------------- filters

export const RANGES = ["all", "today", "yesterday", "7d", "30d", "custom"] as const;
export type Range = (typeof RANGES)[number];
export const STATES = ["all", "action", "waiting", "partner", "done", "open"] as const;
export type StateFilter = (typeof STATES)[number];
export const KINDS = ["all", "lead", "offer", "order"] as const;
export const PARTNER_FILTERS = ["all", "none", "requested", "confirmed", "unavailable"] as const;
export const SORTS = ["waiting", "newest"] as const;
export const PAGE_SIZE = 50;

export type Filters = {
  range: Range;
  from: string | null;
  to: string | null;
  state: StateFilter;
  kind: (typeof KINDS)[number];
  partner: (typeof PARTNER_FILTERS)[number];
  sub: string | null;
  q: string;
  sort: (typeof SORTS)[number];
  page: number;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function pick<T extends readonly string[]>(list: T, v: unknown, fallback: T[number]): T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

/** URL search params → filters; anything unknown falls back to the default. */
export function parseFilters(
  sp: Record<string, string | string[] | undefined>,
  defaults: Partial<Filters> = {},
): Filters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]);
  const state = pick(STATES, one("state"), defaults.state ?? "all");
  const from = typeof one("from") === "string" && DAY.test(one("from")!) ? one("from")! : null;
  const to = typeof one("to") === "string" && DAY.test(one("to")!) ? one("to")! : null;
  const range = pick(RANGES, one("range"), from || to ? "custom" : (defaults.range ?? "all"));
  return {
    range,
    from: range === "custom" ? from : null,
    to: range === "custom" ? to : null,
    state,
    kind: pick(KINDS, one("kind"), defaults.kind ?? "all"),
    partner: pick(PARTNER_FILTERS, one("partner"), "all"),
    sub: typeof one("sub") === "string" && /^[a-z][a-z0-9_-]{0,40}$/.test(one("sub")!) ? one("sub")! : null,
    q: (typeof one("q") === "string" ? one("q")! : "").trim().slice(0, 100),
    sort: pick(SORTS, one("sort"), defaults.sort ?? (state === "action" ? "waiting" : "newest")),
    page: Math.max(1, Math.min(1000, Math.floor(Number(one("page")) || 1))),
  };
}

/** The Riga days a range covers, inclusive, or null for "all". */
export function rangeDays(
  f: Pick<Filters, "range" | "from" | "to">,
  now: Date,
): { from: string; to: string } | null {
  const day = (offset: number) => rigaDay(new Date(now.getTime() - offset * 86_400_000));
  switch (f.range) {
    case "today":
      return { from: day(0), to: day(0) };
    case "yesterday":
      return { from: day(1), to: day(1) };
    case "7d":
      return { from: day(6), to: day(0) };
    case "30d":
      return { from: day(29), to: day(0) };
    case "custom":
      return f.from || f.to ? { from: f.from ?? "0000-01-01", to: f.to ?? "9999-12-31" } : null;
    default:
      return null;
  }
}

function normal(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function matchesSearch(item: WorkItem, q: string): boolean {
  if (!q) return true;
  const hay = normal(
    [
      item.product.name,
      item.product.modelCode,
      item.product.ean,
      item.number,
      item.person,
      item.partner?.partner,
      item.partner?.ref,
      item.searchText,
    ]
      .filter(Boolean)
      .join(" "),
  );
  return normal(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** Everything but the state, so the view counts can be computed from one pass. */
export function matchesBase(item: WorkItem, f: Filters, now: Date): boolean {
  if (f.kind !== "all" && item.kind !== f.kind) return false;
  if (f.sub && item.product.subcategoryId !== f.sub) return false;
  if (f.partner !== "all") {
    if (f.partner === "none" ? item.partner !== null : item.partner?.status !== f.partner) return false;
  }
  const days = rangeDays(f, now);
  if (days) {
    const d = rigaDay(item.date);
    if (d < days.from || d > days.to) return false;
  }
  return matchesSearch(item, f.q);
}

export function matchesState(item: WorkItem, state: StateFilter): boolean {
  if (state === "all") return true;
  if (state === "open") return item.state !== "done";
  return item.state === state;
}

const STATE_ORDER: Record<WorkState, number> = { action: 0, partner: 1, waiting: 2, done: 3 };

export function sortItems(items: WorkItem[], sort: Filters["sort"]): WorkItem[] {
  const t = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);
  return [...items].sort((a, b) =>
    sort === "waiting"
      ? STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
        t(a.waitingSince) - t(b.waitingSince) ||
        b.date.getTime() - a.date.getTime()
      : b.date.getTime() - a.date.getTime() || a.id.localeCompare(b.id),
  );
}

export type ViewCounts = Record<"action" | "waiting" | "partner" | "done" | "all", number>;

/** Filter, count each state under the same other filters, sort, and cut one page. */
export function applyFilters(
  items: WorkItem[],
  f: Filters,
  now: Date,
): { rows: WorkItem[]; total: number; counts: ViewCounts; hasMore: boolean } {
  const base = items.filter((i) => matchesBase(i, f, now));
  const counts: ViewCounts = { action: 0, waiting: 0, partner: 0, done: 0, all: base.length };
  for (const i of base) counts[i.state] += 1;
  const filtered = sortItems(
    base.filter((i) => matchesState(i, f.state)),
    f.sort,
  );
  const start = (f.page - 1) * PAGE_SIZE;
  return {
    rows: filtered.slice(start, start + PAGE_SIZE),
    total: filtered.length,
    counts,
    hasMore: filtered.length > start + PAGE_SIZE,
  };
}

/** The same filters as a query string, with some keys changed (null drops a key). Defaults are left out. */
export function filterQuery(
  f: Filters,
  change: Partial<Record<keyof Filters, string | number | null>> = {},
): string {
  const values: Record<string, string | number | null> = {
    range: f.range === "all" ? null : f.range,
    from: f.from,
    to: f.to,
    state: f.state,
    kind: f.kind === "all" ? null : f.kind,
    partner: f.partner === "all" ? null : f.partner,
    sub: f.sub,
    q: f.q || null,
    sort: null,
    page: null,
    ...change,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values))
    if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Whole days an item has waited ("3 d."), or null. */
export function waitedDays(since: Date | null, now: Date): number | null {
  if (!since) return null;
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000));
}
