import carriersData from "../../../data/carriers.json";
import { addWorkingDays } from "@/domain/delivery/delivery";
import { toDate, toDay, type Country } from "@/domain/delivery/holidays";

// Personal offers and the orders that follow them (docs/ADMIN_AND_OFFERS_PLAN.md).
// Pure rules: what an offer may claim, when it can be accepted, which order
// steps follow which, money splits, delivery promises and deadlines. Nothing
// here touches the database or the UI.

export const VAT_RATE = 21;
const DAY_MS = 24 * 3600 * 1000;

export type OfferStatus = "draft" | "sent" | "opened" | "accepted" | "paid" | "expired" | "cancelled";
export type OrderStatus =
  | "awaiting_payment"
  | "paid"
  | "packed"
  | "shipped"
  | "delivered"
  | "return_requested"
  | "returned"
  | "refunded"
  | "cancelled";
export type BuyerKind = "person" | "company";

// ---------------------------------------------------------------- claims

export type Reference = {
  /** Today's best new in-stock price in the monitored shops. */
  priceCents: number | null;
  /** Lowest such price over the previous 30 days, today included. */
  low30Cents: number | null;
};

/**
 * The saving an offer may state (rule 5, Omnibus): only against the lowest
 * price of the previous 30 days, and only when the offer is below it.
 * Otherwise the offer states the facts (today's shop price) and no saving.
 */
export function savingClaim(priceCents: number, ref: Reference): { savingCents: number } | null {
  const floor = ref.low30Cents ?? null;
  if (floor === null || priceCents >= floor) return null;
  return { savingCents: floor - priceCents };
}

/** Price split for invoices and the admin: VAT is included in the price. Not registered → no VAT. */
export function vatSplit(
  totalCents: number,
  vatRate: number | null,
): { netCents: number; vatCents: number; totalCents: number } {
  if (!vatRate) return { netCents: totalCents, vatCents: 0, totalCents };
  const netCents = Math.round((totalCents * 100) / (100 + vatRate));
  return { netCents, vatCents: totalCents - netCents, totalCents };
}

/** Trilio's margin on one unit: the price without VAT minus the purchase price (without VAT when registered). */
export function margin(
  priceCents: number,
  costCents: number | null,
  vatRate: number | null,
): { cents: number; percent: number } | null {
  if (costCents === null || costCents <= 0) return null;
  const net = vatSplit(priceCents, vatRate).netCents;
  const cents = net - costCents;
  return { cents, percent: net > 0 ? Math.round((cents / net) * 1000) / 10 : 0 };
}

/** VAT rate in force: registered (COMPANY_VAT_NO set) → 21 %, else none. */
export function vatRateFor(vatNo: string | null | undefined): number | null {
  return vatNo && vatNo.trim() ? VAT_RATE : null;
}

// ---------------------------------------------------------------- offer lifecycle

export type OfferState = {
  status: OfferStatus;
  validUntil: Date;
  sentAt: Date | null;
  remindedAt: Date | null;
};

const OPEN_OFFER: OfferStatus[] = ["sent", "opened", "accepted"];

/** Can the recipient still take it? Accepted counts: they may come back to pay. */
export function canAccept(offer: Pick<OfferState, "status" | "validUntil">, now: Date): boolean {
  return OPEN_OFFER.includes(offer.status) && offer.validUntil.getTime() > now.getTime();
}

/** What the offer page shows: live, or why not. */
export function offerPhase(
  offer: Pick<OfferState, "status" | "validUntil">,
  now: Date,
): "draft" | "open" | "expired" | "cancelled" | "paid" {
  if (offer.status === "draft") return "draft";
  if (offer.status === "cancelled") return "cancelled";
  if (offer.status === "paid") return "paid";
  if (offer.status === "expired" || offer.validUntil.getTime() <= now.getTime()) return "expired";
  return "open";
}

/** Sent offers past their date that nobody paid for. */
export function shouldExpire(offer: Pick<OfferState, "status" | "validUntil">, now: Date): boolean {
  return OPEN_OFFER.includes(offer.status) && offer.validUntil.getTime() <= now.getTime();
}

export const REMINDER_BEFORE_MS = 2 * DAY_MS;

/**
 * The one reminder (owner, 24 Oct 2026): two days before expiry, to anyone
 * who has not accepted, at most once, and not on the day it was sent.
 */
export function reminderDue(offer: OfferState, now: Date): boolean {
  if (offer.status !== "sent" && offer.status !== "opened") return false;
  if (offer.remindedAt || !offer.sentAt) return false;
  const left = offer.validUntil.getTime() - now.getTime();
  if (left <= 0 || left > REMINDER_BEFORE_MS) return false;
  return now.getTime() - offer.sentAt.getTime() >= DAY_MS;
}

/** Default validity: seven days from now, ending at 23:59 Riga time on that day. */
export function defaultValidUntil(now: Date, days = 7): Date {
  const end = new Date(now.getTime() + days * DAY_MS);
  return endOfRigaDay(end);
}

const RIGA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Riga",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function rigaParts(d: Date): { day: string; hour: number } {
  const p = Object.fromEntries(RIGA.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** 23:59:59 of the given instant's calendar day in Riga, as an instant (Riga is UTC+2, UTC+3 in summer). */
export function endOfRigaDay(d: Date): Date {
  const { day } = rigaParts(d);
  const summer = new Date(`${day}T23:59:59+03:00`);
  return rigaParts(summer).hour === 23 ? summer : new Date(`${day}T23:59:59+02:00`);
}

// ---------------------------------------------------------------- order lifecycle

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  awaiting_payment: ["paid", "cancelled"],
  paid: ["packed", "shipped", "return_requested", "refunded"],
  packed: ["shipped", "return_requested", "refunded"],
  shipped: ["delivered", "return_requested"],
  delivered: ["return_requested"],
  return_requested: ["returned", "refunded"],
  returned: ["refunded"],
  refunded: [],
  cancelled: [],
};

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  return NEXT[from].includes(to);
}

export function nextSteps(from: OrderStatus): OrderStatus[] {
  return NEXT[from];
}

/** Orders that count as sold (revenue, paid ÷ sent). */
export function isSold(status: OrderStatus): boolean {
  return ["paid", "packed", "shipped", "delivered", "return_requested", "returned"].includes(status);
}

export const WITHDRAWAL_DAYS = 14;

/**
 * A private buyer may withdraw without a reason until 14 days after receiving
 * the goods (Consumer Rights Protection Law), and at any time before. Businesses
 * have no such right.
 */
export function canWithdraw(
  order: { buyerKind: BuyerKind; status: OrderStatus; deliveredAt: Date | null },
  now: Date,
): boolean {
  if (order.buyerKind !== "person") return false;
  if (!["paid", "packed", "shipped", "delivered"].includes(order.status)) return false;
  const deadline = withdrawalDeadline(order.deliveredAt);
  return deadline === null || now.getTime() <= deadline.getTime();
}

export function withdrawalDeadline(deliveredAt: Date | null): Date | null {
  return deliveredAt ? endOfRigaDay(new Date(deliveredAt.getTime() + WITHDRAWAL_DAYS * DAY_MS)) : null;
}

export const LATE_AFTER_WORKING_DAYS = 5;

/** Shipped more than five working days ago and still not delivered: the admin should look. */
export function isLate(
  order: { status: OrderStatus; shippedAt: Date | null },
  now: Date,
  country: Country = "LV",
): boolean {
  if (order.status !== "shipped" || !order.shippedAt) return false;
  const due = toDate(addWorkingDays(toDay(order.shippedAt), LATE_AFTER_WORKING_DAYS, country));
  return now.getTime() > due.getTime() + DAY_MS;
}

export const FEEDBACK_AFTER_MS = 7 * DAY_MS;

/** "Viss kārtībā?" goes once, seven days after delivery. */
export function feedbackDue(
  order: { status: OrderStatus; deliveredAt: Date | null; feedbackAskedAt: Date | null },
  now: Date,
): boolean {
  return (
    order.status === "delivered" &&
    !!order.deliveredAt &&
    !order.feedbackAskedAt &&
    now.getTime() - order.deliveredAt.getTime() >= FEEDBACK_AFTER_MS
  );
}

/** Guarantee the buyer gets: two years by law for private buyers, the offer's warranty for businesses. */
export function guaranteeMonths(buyerKind: BuyerKind, warrantyMonths: number): number {
  return buyerKind === "person" ? Math.max(24, warrantyMonths) : warrantyMonths;
}

// ---------------------------------------------------------------- delivery

/** Big appliances: courier to the door, with the carry-in question. Everything else may go to a parcel locker. */
const LARGE = new Set(["fridge", "freezer", "washer", "dryer", "dish", "hob", "oven", "hood", "micro"]);

export function deliveryOptions(subcategoryId: string): { locker: boolean; carryIn: boolean } {
  const large = LARGE.has(subcategoryId);
  return { locker: !large, carryIn: large };
}

/** Promised delivery date: working days from today (rule 6). */
export function deliveryBy(now: Date, workingDays: number, country: Country = "LV"): Date {
  return toDate(addWorkingDays(toDay(now), Math.max(1, workingDays), country));
}

// ---------------------------------------------------------------- carriers

export type Carrier = { id: string; name: string; trackingUrl: string | null };

export const CARRIERS: Carrier[] = carriersData.carriers;

export function carrierById(id: string | null | undefined): Carrier | null {
  return CARRIERS.find((c) => c.id === id) ?? null;
}

/** The carrier's public tracking page for this parcel, or null when the carrier has none configured. */
export function trackingUrl(carrierId: string, number: string): string | null {
  const template = carrierById(carrierId)?.trackingUrl;
  const clean = number.trim();
  if (!template || !clean) return null;
  return template.replace("{number}", encodeURIComponent(clean));
}

// ---------------------------------------------------------------- numbers

export function invoiceNumber(year: number, seq: number): string {
  return `TR-${year}-${String(seq).padStart(4, "0")}`;
}

const ORDER_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** "T-7K2M9Q": short, unambiguous, readable over the phone. `random` returns bytes. */
export function orderNumber(random: (n: number) => Uint8Array): string {
  const bytes = random(6);
  return `T-${Array.from(bytes, (b) => ORDER_ALPHABET[b % ORDER_ALPHABET.length]).join("")}`;
}
