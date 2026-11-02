// The query marker a page comes back with from "Turpināt ar Google" (docs/PRICE_NOTIFY_PLAN.md §8.6).
// It only asks the server to look: the request itself waits in this browser's httpOnly cookie.
export const PENDING_PARAM = "pieprasits";

/** The page to come back to, with the marker (and without any #fragment). */
export function withPending(path: string): string {
  const base = path.split("#")[0]!;
  return `${base}${base.includes("?") ? "&" : "?"}${PENDING_PARAM}=1`;
}

/** Window event the return step sends so that product's card shows its "where we will write" line. */
export const REQUESTED_EVENT = "trilio:requested";
export type RequestedDetail = { productId: string; email: string };
