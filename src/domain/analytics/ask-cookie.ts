// The answer to the question before the shop (docs/PRICE_NOTIFY_PLAN.md §8.4,
// docs/CLICK_QUALITY_PLAN.md §2): one first-party functional cookie holding the
// time of the answer, read by the page and by /go/. It stores a choice the
// shopper made, so it needs no consent (docs: /sikdatnes).

export const ASK_COOKIE = "trilio_ask";
/** How long one answer holds. */
export const ASK_TTL_MS = 24 * 60 * 60 * 1000;

/** Whether the cookie's value is an answer from the last 24 hours. */
export function askAnswered(value: string | null | undefined, now = Date.now()): boolean {
  const at = Number(value);
  return Number.isFinite(at) && at > 0 && at <= now + 60_000 && now - at < ASK_TTL_MS;
}

/** The cookie's value in a Cookie header, or null. */
export function cookieValue(header: string | null | undefined, name = ASK_COOKIE): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
