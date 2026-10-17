import type { OfferView, Urgency } from "@/domain/catalog/types";
import { addDays, isWorkingDay, toDate, toDay, type CalendarDay, type Country } from "./holidays";

// Spec §2.3 and rule 6: delivery dates count working days only, respect
// public holidays, and prefer the shop's own ETA. Never "this week" wording:
// the UI always renders a concrete date.

/** Adds n working days to a calendar day. An order placed on a non-working day starts counting from the next working day. */
export function addWorkingDays(from: CalendarDay, n: number, country: Country): CalendarDay {
  let day = from;
  let remaining = n;
  while (remaining > 0) {
    day = addDays(day, 1);
    if (isWorkingDay(country, day)) remaining--;
  }
  return day;
}

export const URGENCY_WORKING_DAYS: Record<Exclude<Urgency, "no_rush">, number> = {
  asap: 3,
  two_weeks: 5,
};

/** The date shown under the urgency options ("piegāde līdz trešdienai, 21. oktobrim"). */
export function urgencyDate(urgency: Exclude<Urgency, "no_rush">, now: Date, country: Country): Date {
  return toDate(addWorkingDays(toDay(now), URGENCY_WORKING_DAYS[urgency], country));
}

/** Expected delivery date for an offer: the shop's ETA when the feed has one, else the store default. */
export function deliveryDate(
  offer: Pick<OfferView, "deliveryEtaDays" | "storeDefaultDeliveryDays" | "stock">,
  now: Date,
  country: Country,
): Date | null {
  if (offer.stock === "out") return null;
  const days = (offer.deliveryEtaDays ?? offer.storeDefaultDeliveryDays) + (offer.stock === "soon" ? 7 : 0);
  return toDate(addWorkingDays(toDay(now), days, country));
}

export function workingDaysUntil(
  offer: Pick<OfferView, "deliveryEtaDays" | "storeDefaultDeliveryDays" | "stock">,
): number | null {
  if (offer.stock === "out") return null;
  return (offer.deliveryEtaDays ?? offer.storeDefaultDeliveryDays) + (offer.stock === "soon" ? 7 : 0);
}
