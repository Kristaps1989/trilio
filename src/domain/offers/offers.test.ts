import { describe, expect, it } from "vitest";
import {
  CARRIERS,
  canAccept,
  canMove,
  canWithdraw,
  carrierById,
  defaultValidUntil,
  deliveryBy,
  deliveryOptions,
  endOfRigaDay,
  feedbackDue,
  guaranteeMonths,
  invoiceNumber,
  isLate,
  isSold,
  margin,
  nextSteps,
  offerPhase,
  orderNumber,
  reminderDue,
  savingClaim,
  shouldExpire,
  trackingUrl,
  vatRateFor,
  vatSplit,
  withdrawalDeadline,
} from "./offers";

const at = (iso: string) => new Date(iso);
const DAY = 24 * 3600 * 1000;

describe("savingClaim (rule 5: only against the 30-day low)", () => {
  it("claims the difference to the 30-day low when the offer is below it", () => {
    expect(savingClaim(44900, { priceCents: 48900, low30Cents: 47900 })).toEqual({ savingCents: 3000 });
  });
  it("claims nothing when the offer is only below today's price", () => {
    expect(savingClaim(48000, { priceCents: 48900, low30Cents: 47900 })).toBeNull();
    expect(savingClaim(47900, { priceCents: 48900, low30Cents: 47900 })).toBeNull();
  });
  it("claims nothing without price history", () => {
    expect(savingClaim(100, { priceCents: 200, low30Cents: null })).toBeNull();
  });
});

describe("money", () => {
  it("splits VAT out of a VAT-inclusive price, or none when not registered", () => {
    expect(vatSplit(12100, 21)).toEqual({ netCents: 10000, vatCents: 2100, totalCents: 12100 });
    expect(vatSplit(44900, null)).toEqual({ netCents: 44900, vatCents: 0, totalCents: 44900 });
  });
  it("computes the margin on the net price", () => {
    expect(margin(12100, 8000, 21)).toEqual({ cents: 2000, percent: 20 });
    expect(margin(10000, 9000, null)).toEqual({ cents: 1000, percent: 10 });
    expect(margin(10000, null, null)).toBeNull();
    expect(margin(10000, 0, null)).toBeNull();
    expect(margin(0, 100, null)).toEqual({ cents: -100, percent: 0 });
  });
  it("VAT applies once a VAT number is configured", () => {
    expect(vatRateFor("LV40000000000")).toBe(21);
    expect(vatRateFor("  ")).toBeNull();
    expect(vatRateFor(undefined)).toBeNull();
  });
});

describe("offer lifecycle", () => {
  const now = at("2026-10-24T10:00:00Z");
  const open = { status: "sent" as const, validUntil: at("2026-10-30T20:59:59Z") };
  it("is open while sent, opened or accepted and before its date", () => {
    expect(canAccept(open, now)).toBe(true);
    expect(canAccept({ ...open, status: "opened" }, now)).toBe(true);
    expect(canAccept({ ...open, status: "accepted" }, now)).toBe(true);
    expect(canAccept({ ...open, status: "draft" }, now)).toBe(false);
    expect(canAccept({ ...open, status: "paid" }, now)).toBe(false);
    expect(canAccept({ ...open, validUntil: at("2026-10-24T09:00:00Z") }, now)).toBe(false);
  });
  it("names the phase the offer page shows", () => {
    expect(offerPhase(open, now)).toBe("open");
    expect(offerPhase({ ...open, status: "draft" }, now)).toBe("draft");
    expect(offerPhase({ ...open, status: "cancelled" }, now)).toBe("cancelled");
    expect(offerPhase({ ...open, status: "paid" }, now)).toBe("paid");
    expect(offerPhase({ ...open, status: "expired" }, now)).toBe("expired");
    expect(offerPhase({ ...open, validUntil: at("2026-10-01T00:00:00Z") }, now)).toBe("expired");
  });
  it("expires open offers past their date only", () => {
    expect(shouldExpire({ ...open, validUntil: at("2026-10-24T09:59:59Z") }, now)).toBe(true);
    expect(shouldExpire(open, now)).toBe(false);
    expect(shouldExpire({ status: "paid", validUntil: at("2026-10-01T00:00:00Z") }, now)).toBe(false);
  });
  it("reminds once, two days before expiry, never on the day it was sent", () => {
    const offer = {
      status: "sent" as const,
      validUntil: new Date(now.getTime() + DAY),
      sentAt: new Date(now.getTime() - 5 * DAY),
      remindedAt: null,
    };
    expect(reminderDue(offer, now)).toBe(true);
    expect(reminderDue({ ...offer, status: "opened" }, now)).toBe(true);
    expect(reminderDue({ ...offer, remindedAt: now }, now)).toBe(false);
    expect(reminderDue({ ...offer, status: "accepted" }, now)).toBe(false);
    expect(reminderDue({ ...offer, sentAt: null }, now)).toBe(false);
    expect(reminderDue({ ...offer, validUntil: new Date(now.getTime() + 3 * DAY) }, now)).toBe(false);
    expect(reminderDue({ ...offer, validUntil: new Date(now.getTime() - 1) }, now)).toBe(false);
    expect(reminderDue({ ...offer, sentAt: new Date(now.getTime() - 3600_000) }, now)).toBe(false);
  });
  it("ends a validity day at 23:59:59 Riga time, in winter and in summer", () => {
    expect(endOfRigaDay(at("2026-10-24T10:00:00Z")).toISOString()).toBe("2026-10-24T20:59:59.000Z");
    expect(endOfRigaDay(at("2026-12-01T10:00:00Z")).toISOString()).toBe("2026-12-01T21:59:59.000Z");
    // 23:30 UTC on 24 Oct is already 25 Oct in Riga, the day summer time ends.
    expect(endOfRigaDay(at("2026-10-24T23:30:00Z")).toISOString()).toBe("2026-10-25T21:59:59.000Z");
    expect(defaultValidUntil(at("2026-10-24T10:00:00Z")).toISOString()).toBe("2026-10-31T21:59:59.000Z");
  });
});

describe("order lifecycle", () => {
  it("allows only the next steps", () => {
    expect(canMove("awaiting_payment", "paid")).toBe(true);
    expect(canMove("paid", "shipped")).toBe(true);
    expect(canMove("shipped", "delivered")).toBe(true);
    expect(canMove("delivered", "return_requested")).toBe(true);
    expect(canMove("return_requested", "refunded")).toBe(true);
    expect(canMove("awaiting_payment", "shipped")).toBe(false);
    expect(canMove("delivered", "paid")).toBe(false);
    expect(nextSteps("refunded")).toEqual([]);
    expect(nextSteps("cancelled")).toEqual([]);
  });
  it("counts paid and later as sold, refunds and cancellations not", () => {
    expect(isSold("delivered")).toBe(true);
    expect(isSold("refunded")).toBe(false);
    expect(isSold("awaiting_payment")).toBe(false);
  });
  it("private buyers may withdraw before delivery and 14 days after; businesses never", () => {
    const delivered = at("2026-10-10T12:00:00Z");
    const person = { buyerKind: "person" as const, status: "delivered" as const, deliveredAt: delivered };
    expect(canWithdraw(person, at("2026-10-24T12:00:00Z"))).toBe(true);
    expect(canWithdraw(person, at("2026-10-25T12:00:00Z"))).toBe(false);
    expect(canWithdraw({ ...person, status: "shipped", deliveredAt: null }, at("2027-01-01T00:00:00Z"))).toBe(
      true,
    );
    expect(canWithdraw({ ...person, buyerKind: "company" }, at("2026-10-11T00:00:00Z"))).toBe(false);
    expect(canWithdraw({ ...person, status: "return_requested" }, at("2026-10-11T00:00:00Z"))).toBe(false);
    expect(withdrawalDeadline(delivered)?.toISOString()).toBe("2026-10-24T20:59:59.000Z");
    expect(withdrawalDeadline(null)).toBeNull();
  });
  it("flags a parcel shipped more than five working days ago", () => {
    // Shipped Friday 16 Oct: five working days end Friday 23 Oct.
    const shipped = { status: "shipped" as const, shippedAt: at("2026-10-16T10:00:00Z") };
    expect(isLate(shipped, at("2026-10-23T12:00:00Z"))).toBe(false);
    expect(isLate(shipped, at("2026-10-26T12:00:00Z"))).toBe(true);
    expect(isLate({ ...shipped, status: "delivered" }, at("2026-11-26T12:00:00Z"))).toBe(false);
    expect(isLate({ ...shipped, shippedAt: null }, at("2026-11-26T12:00:00Z"))).toBe(false);
  });
  it("asks for feedback once, a week after delivery", () => {
    const order = {
      status: "delivered" as const,
      deliveredAt: at("2026-10-10T12:00:00Z"),
      feedbackAskedAt: null,
    };
    expect(feedbackDue(order, at("2026-10-17T12:00:00Z"))).toBe(true);
    expect(feedbackDue(order, at("2026-10-16T12:00:00Z"))).toBe(false);
    expect(
      feedbackDue({ ...order, feedbackAskedAt: at("2026-10-17T12:00:00Z") }, at("2026-10-20T00:00:00Z")),
    ).toBe(false);
    expect(feedbackDue({ ...order, status: "return_requested" }, at("2026-10-20T00:00:00Z"))).toBe(false);
  });
  it("gives private buyers at least the two-year legal guarantee", () => {
    expect(guaranteeMonths("person", 12)).toBe(24);
    expect(guaranteeMonths("person", 36)).toBe(36);
    expect(guaranteeMonths("company", 12)).toBe(12);
  });
});

describe("delivery", () => {
  it("offers lockers for small appliances and the carry-in question for big ones", () => {
    expect(deliveryOptions("kettle")).toEqual({ locker: true, carryIn: false });
    expect(deliveryOptions("fridge")).toEqual({ locker: false, carryIn: true });
    expect(deliveryOptions("washer")).toEqual({ locker: false, carryIn: true });
  });
  it("promises a date in working days, skipping weekends and holidays", () => {
    // Friday 24 Oct 2026 + 3 working days = Wednesday 28 Oct.
    expect(deliveryBy(at("2026-10-23T10:00:00Z"), 3).toISOString().slice(0, 10)).toBe("2026-10-28");
    // 17 Nov (Tuesday) + 1 skips 18 Nov (Proclamation Day).
    expect(deliveryBy(at("2026-11-17T10:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-11-19");
    expect(deliveryBy(at("2026-10-23T10:00:00Z"), 0).toISOString().slice(0, 10)).toBe("2026-10-26");
  });
});

describe("carriers and numbers", () => {
  it("builds tracking links from configuration", () => {
    expect(CARRIERS.map((c) => c.id)).toContain("omniva");
    expect(trackingUrl("omniva", " CE123456789EE ")).toBe(
      "https://www.omniva.lv/sutijumu-izsekosana/?barcode=CE123456789EE",
    );
    expect(trackingUrl("courier_other", "123")).toBeNull();
    expect(trackingUrl("omniva", "  ")).toBeNull();
    expect(trackingUrl("nobody", "1")).toBeNull();
    expect(carrierById(null)).toBeNull();
    expect(carrierById("dpd")?.name).toBe("DPD");
  });
  it("numbers invoices per year and orders readably", () => {
    expect(invoiceNumber(2026, 7)).toBe("TR-2026-0007");
    expect(orderNumber(() => new Uint8Array([0, 1, 2, 31, 32, 255]))).toBe("T-234Z2Z");
  });
});
