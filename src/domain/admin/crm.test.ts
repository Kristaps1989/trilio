import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE,
  applyFilters,
  classifyLead,
  classifyOffer,
  classifyOrder,
  filterQuery,
  matchesSearch,
  parseFilters,
  rangeDays,
  sortItems,
  waitedDays,
  type PartnerMark,
  type WorkItem,
} from "./crm";

const d = (s: string) => new Date(`${s}T10:00:00Z`);
const NOW = d("2026-10-30");
const requested: PartnerMark = {
  status: "requested",
  partner: "Euronics",
  ref: "48213",
  costCents: null,
  at: d("2026-10-28"),
};

describe("leads", () => {
  const base = {
    firstSavedAt: d("2026-10-20"),
    lastSavedAt: d("2026-10-27"),
    openOffers: 0,
    paidOffers: 0,
    lastOfferAt: null,
    partner: null,
  };
  it("a fresh lead is Trilio's turn since the first save: ask a partner", () => {
    expect(classifyLead(base)).toEqual({
      stage: "new",
      state: "action",
      next: "request_partner",
      waitingSince: d("2026-10-20"),
    });
  });
  it("asked from a partner, it waits for the partner; confirmed, it is time to offer", () => {
    expect(classifyLead({ ...base, partner: requested })).toMatchObject({
      stage: "requested",
      state: "partner",
      next: "record_answer",
    });
    expect(
      classifyLead({ ...base, partner: { ...requested, status: "confirmed", costCents: 60000 } }),
    ).toMatchObject({ stage: "confirmed", state: "action", next: "make_offer" });
    expect(classifyLead({ ...base, partner: { ...requested, status: "unavailable" } }).state).toBe("done");
  });
  it("with an offer out it waits for the shopper; bought is done until someone saves it again", () => {
    expect(classifyLead({ ...base, openOffers: 1, lastOfferAt: d("2026-10-28") })).toMatchObject({
      stage: "offered",
      state: "waiting",
    });
    expect(classifyLead({ ...base, paidOffers: 1, lastOfferAt: d("2026-10-28") })).toMatchObject({
      stage: "won",
      state: "done",
    });
    const again = classifyLead({
      ...base,
      paidOffers: 1,
      lastOfferAt: d("2026-10-25"),
      lastSavedAt: d("2026-10-29"),
    });
    expect(again).toMatchObject({ stage: "new", state: "action", waitingSince: d("2026-10-29") });
  });
});

describe("offers and orders", () => {
  const offer = { createdAt: d("2026-10-25"), sentAt: null, openedAt: null, acceptedAt: null, partner: null };
  it("a draft is Trilio's to send, unless it waits for the partner; sent waits for the shopper", () => {
    expect(classifyOffer({ ...offer, status: "draft" })).toMatchObject({
      state: "action",
      next: "send_offer",
    });
    expect(classifyOffer({ ...offer, status: "draft", partner: requested })).toMatchObject({
      state: "partner",
    });
    expect(classifyOffer({ ...offer, status: "sent", sentAt: d("2026-10-26") })).toMatchObject({
      state: "waiting",
      waitingSince: d("2026-10-26"),
    });
    expect(classifyOffer({ ...offer, status: "opened" }).state).toBe("waiting");
    expect(classifyOffer({ ...offer, status: "accepted" }).state).toBe("waiting");
    for (const s of ["paid", "expired", "cancelled"] as const)
      expect(classifyOffer({ ...offer, status: s }).state).toBe("done");
  });

  const order = {
    createdAt: d("2026-10-25"),
    paidAt: d("2026-10-26"),
    packedAt: null,
    shippedAt: null,
    returnRequestedAt: null,
    returnedAt: null,
    late: false,
    problemSince: null,
    partner: null,
  };
  it("each order step says what is next, and whose turn it is", () => {
    expect(classifyOrder({ ...order, status: "awaiting_payment" }).state).toBe("waiting");
    expect(classifyOrder({ ...order, status: "paid" })).toMatchObject({
      state: "action",
      next: "pack",
      waitingSince: d("2026-10-26"),
    });
    expect(classifyOrder({ ...order, status: "paid", partner: requested })).toMatchObject({
      state: "partner",
    });
    expect(classifyOrder({ ...order, status: "packed", packedAt: d("2026-10-27") }).next).toBe("ship");
    expect(classifyOrder({ ...order, status: "shipped", shippedAt: d("2026-10-27") }).state).toBe("waiting");
    expect(classifyOrder({ ...order, status: "shipped", shippedAt: d("2026-10-20"), late: true }).next).toBe(
      "check_parcel",
    );
    expect(
      classifyOrder({ ...order, status: "return_requested", returnRequestedAt: d("2026-10-29") }).next,
    ).toBe("contact_buyer");
    expect(classifyOrder({ ...order, status: "returned", returnedAt: d("2026-10-29") }).next).toBe("refund");
    expect(classifyOrder({ ...order, status: "delivered" }).state).toBe("done");
    expect(classifyOrder({ ...order, status: "delivered", problemSince: d("2026-10-29") })).toMatchObject({
      state: "action",
      next: "resolve_problem",
    });
    expect(classifyOrder({ ...order, status: "refunded", problemSince: d("2026-10-29") }).state).toBe("done");
  });
});

function item(over: Partial<WorkItem>): WorkItem {
  return {
    kind: "order",
    id: "x",
    href: "/admin/pasutijumi/x",
    number: "T-2026-0001",
    product: {
      id: "p",
      name: "Bosch Series 4 ledusskapis",
      modelCode: "KGN36NWEA",
      ean: "4242005",
      subcategoryId: "fridge",
    },
    person: "Anna Bērziņa",
    date: d("2026-10-30"),
    amountCents: 67000,
    partner: null,
    stage: "paid",
    state: "action",
    next: "pack",
    waitingSince: d("2026-10-29"),
    ...over,
  };
}

describe("filters", () => {
  it("reads the URL, falling back to defaults", () => {
    const f = parseFilters({
      range: "7d",
      state: "partner",
      kind: "order",
      q: "  KGN ",
      page: "2",
      sub: "fridge",
    });
    expect(f).toMatchObject({
      range: "7d",
      state: "partner",
      kind: "order",
      q: "KGN",
      page: 2,
      sub: "fridge",
      sort: "newest",
    });
    expect(parseFilters({}, { state: "action" })).toMatchObject({
      state: "action",
      sort: "waiting",
      range: "all",
      page: 1,
    });
    expect(parseFilters({ range: "nope", state: "x", page: "-3", sub: "Bad Sub" })).toMatchObject({
      range: "all",
      state: "all",
      page: 1,
      sub: null,
    });
    expect(parseFilters({ from: "2026-10-01", to: "2026-10-15" })).toMatchObject({
      range: "custom",
      from: "2026-10-01",
      to: "2026-10-15",
    });
    expect(parseFilters({ from: "1.10.2026" }).from).toBeNull();
  });

  it("turns a period into Riga days", () => {
    expect(rangeDays({ range: "today", from: null, to: null }, NOW)).toEqual({
      from: "2026-10-30",
      to: "2026-10-30",
    });
    expect(rangeDays({ range: "yesterday", from: null, to: null }, NOW)).toEqual({
      from: "2026-10-29",
      to: "2026-10-29",
    });
    expect(rangeDays({ range: "7d", from: null, to: null }, NOW)).toEqual({
      from: "2026-10-24",
      to: "2026-10-30",
    });
    expect(rangeDays({ range: "30d", from: null, to: null }, NOW)!.from).toBe("2026-10-01");
    expect(rangeDays({ range: "custom", from: "2026-10-05", to: null }, NOW)).toEqual({
      from: "2026-10-05",
      to: "9999-12-31",
    });
    expect(rangeDays({ range: "custom", from: null, to: null }, NOW)).toBeNull();
    expect(rangeDays({ range: "all", from: null, to: null }, NOW)).toBeNull();
  });

  it("finds by number, model code, EAN, person and partner order, without diacritics", () => {
    const i = item({ partner: requested });
    for (const q of ["T-2026-0001", "kgn36", "4242005", "berzina", "48213", "euronics bosch"])
      expect(matchesSearch(i, q)).toBe(true);
    expect(matchesSearch(i, "samsung")).toBe(false);
  });

  it("counts every state under the other filters, sorts the longest-waiting first, and pages", () => {
    const items = [
      item({ id: "a", waitingSince: d("2026-10-29") }),
      item({ id: "b", waitingSince: d("2026-10-20") }),
      item({ id: "c", state: "waiting", next: null }),
      item({ id: "d", state: "partner", partner: requested }),
      item({ id: "e", state: "done", next: null, date: d("2026-09-01") }),
      item({
        id: "f",
        kind: "lead",
        product: { id: "q", name: "Tējkanna", modelCode: null, ean: null, subcategoryId: "kettle" },
      }),
    ];
    const r = applyFilters(items, parseFilters({ state: "action" }, { sort: "waiting" }), NOW);
    expect(r.rows.map((x) => x.id)).toEqual(["b", "a", "f"]);
    expect(r.counts).toEqual({ action: 3, waiting: 1, partner: 1, done: 1, all: 6 });
    expect(applyFilters(items, parseFilters({ partner: "requested" }), NOW).rows.map((x) => x.id)).toEqual([
      "d",
    ]);
    expect(applyFilters(items, parseFilters({ partner: "none", kind: "order" }), NOW).total).toBe(4);
    expect(applyFilters(items, parseFilters({ range: "today" }), NOW).counts.done).toBe(0);
    expect(applyFilters(items, parseFilters({ sub: "kettle" }), NOW).rows.map((x) => x.id)).toEqual(["f"]);
    expect(applyFilters(items, parseFilters({ state: "open" }), NOW).total).toBe(5);
    const many = Array.from({ length: PAGE_SIZE + 3 }, (_, n) => item({ id: `m${n}` }));
    const p1 = applyFilters(many, parseFilters({}), NOW);
    expect(p1).toMatchObject({ total: PAGE_SIZE + 3, hasMore: true });
    expect(applyFilters(many, parseFilters({ page: "2" }), NOW).rows).toHaveLength(3);
    expect(
      sortItems([item({ id: "z", date: d("2026-10-01") }), item({ id: "y" })], "newest").map((x) => x.id),
    ).toEqual(["y", "z"]);
  });

  it("writes the view back as a query, without defaults", () => {
    const f = parseFilters({ state: "partner", q: "KGN", range: "7d" });
    expect(filterQuery(f)).toBe("?range=7d&state=partner&q=KGN");
    expect(filterQuery(f, { state: "done", q: null })).toBe("?range=7d&state=done");
    expect(filterQuery(parseFilters({}), { page: 2 })).toBe("?state=all&page=2");
  });

  it("counts whole days waited", () => {
    expect(waitedDays(d("2026-10-27"), NOW)).toBe(3);
    expect(waitedDays(null, NOW)).toBeNull();
    expect(waitedDays(d("2026-10-31"), NOW)).toBe(0);
  });
});
