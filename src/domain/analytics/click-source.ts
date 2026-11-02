// Where a shop click came from (Admin → Statistika, owner 2 Nov 2026), carried
// as /go/{offer}?from=… so the redirect can record it without a cookie.
export const CLICK_SOURCES = ["ask", "card", "newtab", "note", "wishlist", "refurb"] as const;
export type ClickSource = (typeof CLICK_SOURCES)[number];

/** The source named in a /go/ link; the older `ask=1` means the question before the shop. */
export function clickSource(params: URLSearchParams): ClickSource | null {
  const from = params.get("from");
  if (from && (CLICK_SOURCES as readonly string[]).includes(from)) return from as ClickSource;
  return params.get("ask") === "1" ? "ask" : null;
}

/** A /go/ link with its source added. */
export function withSource(href: string, source: ClickSource): string {
  return `${href}${href.includes("?") ? "&" : "?"}from=${source}`;
}
