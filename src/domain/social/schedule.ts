import type { SocialKind } from "@/db/schema";

// When posts go out and which kind fills a slot (docs/SOCIAL_PLAN.md §4).
// Pure: the job passes the clock and what today's data allows.

export type SlotKey = "mon" | "wed" | "fri" | "sun";
export type Slot = { key: SlotKey; at: Date; day: string };

/** Riga weekday (0 = Sunday) → slot and local time. */
const SLOTS: Record<number, { key: SlotKey; hour: number; minute: number }> = {
  1: { key: "mon", hour: 19, minute: 0 },
  3: { key: "wed", hour: 19, minute: 0 },
  5: { key: "fri", hour: 19, minute: 0 },
  0: { key: "sun", hour: 11, minute: 0 },
};

/** A post is drafted this long before its slot, so the owner has a day to look at it. */
export const DRAFT_AHEAD_MS = 26 * 3600 * 1000;
/** An approved post whose slot passed longer ago than this is not sent late. */
export const LATE_LIMIT_MS = 6 * 3600 * 1000;

/** Owner's first categories for the picks posts, then rotation by traffic (D5). */
export const FIRST_CATEGORIES = ["dish", "fridge", "vacuum", "washer"];

/** Type E needs this many results views for the top category in 7 days; type F this much interest per product. */
export const MIN_CATEGORY_VIEWS = 50;
export const MIN_PRODUCT_INTEREST = 30;
/** Type B: the price is at least this much below the 30-day low. */
export const MIN_DROP_PERCENT = 5;

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Riga",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Riga",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const rigaDayOf = (d: Date) => dayFormat.format(d);

/** Riga's offset from UTC at an instant, in ms (2 h in winter, 3 h in summer). */
function offsetMs(at: Date): number {
  const p = Object.fromEntries(partsFormat.formatToParts(at).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!);
  return wall - Math.floor(at.getTime() / 60_000) * 60_000;
}

/** The instant of a Riga wall-clock time on a Riga day ("2026-11-02", 19, 0). */
export function rigaTime(day: string, hour: number, minute = 0): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let at = new Date(guess - offsetMs(new Date(guess)));
  // Across a daylight-saving change the first guess can be an hour off.
  at = new Date(guess - offsetMs(at));
  return at;
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** Every slot with from <= at < to. */
export function slotsBetween(from: Date, to: Date): Slot[] {
  const out: Slot[] = [];
  for (let day = rigaDayOf(from); day <= rigaDayOf(to); day = addDays(day, 1)) {
    const s = SLOTS[weekday(day)];
    if (!s) continue;
    const at = rigaTime(day, s.hour, s.minute);
    if (at >= from && at < to) out.push({ key: s.key, at, day });
  }
  return out;
}

/** The next evening (19:00 Riga) after `now` that is not taken: for a post made by hand. */
export function nextFreeEvening(now: Date, taken: Date[]): Date {
  const busy = new Set(taken.map((d) => d.getTime()));
  for (let i = 0; i < 60; i++) {
    const at = rigaTime(addDays(rigaDayOf(now), i), 19);
    if (at > now && !busy.has(at.getTime())) return at;
  }
  return rigaTime(addDays(rigaDayOf(now), 60), 19);
}

/** ISO week number of a Riga day, for "every other week". */
export function isoWeek(day: string): number {
  const d = new Date(`${day}T12:00:00Z`);
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

export type Availability = {
  priceDrop: boolean;
  paidOffer: boolean;
  topCategories: boolean;
  topProducts: boolean;
};

/** Which kind fills a slot (§4), or null when the slot stays empty this week. */
export function pickKind(slot: Pick<Slot, "key" | "day">, has: Availability): SocialKind | null {
  switch (slot.key) {
    case "mon":
      return "picks";
    case "wed":
      return has.priceDrop ? "price_drop" : "advice";
    case "fri":
      if (has.paidOffer) return "offer";
      if (isoWeek(slot.day) % 2 === 0 && has.topProducts) return "top_products";
      return "picks";
    case "sun":
      return has.topCategories ? "top_categories" : null;
  }
}

/** The category for a picks or advice post: the owner's first four, then by traffic, skipping recent ones. */
export function nextCategory(byTraffic: string[], recent: string[], known: Set<string>): string | null {
  const order = [...new Set([...FIRST_CATEGORIES, ...byTraffic])].filter((id) => known.has(id));
  return order.find((id) => !recent.includes(id)) ?? order[0] ?? null;
}
