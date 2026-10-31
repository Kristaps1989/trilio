// The Meta Pixel in the browser (docs/META_ADS_PLAN.md §2). `fbq` exists only
// after the visitor accepted cookies and Analytics loaded the Pixel; before
// that, and for a visitor who declined, these calls do nothing.

type Fbq = ((...args: unknown[]) => void) & { callMethod?: unknown; queue?: unknown[] };
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export type MetaEvent = "PageView" | "ViewContent" | "Lead";

/** A standard event; `eventId` matches the server's copy (Conversions API) so Meta counts it once. */
export function metaTrack(event: MetaEvent, params?: Record<string, string>, eventId?: string): void {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", event, params ?? {}, eventId ? { eventID: eventId } : undefined);
}

/** A custom event (measured, not optimised for): "ShopClick". */
export function metaTrackCustom(event: "ShopClick", params?: Record<string, string>): void {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("trackCustom", event, params ?? {});
}

/** Meta's loader, written out: a queue until fbevents.js arrives. */
export function loadMetaPixel(pixelId: string): void {
  if (window.fbq) return;
  const fbq: Fbq = function (...args: unknown[]) {
    if (fbq.callMethod) (fbq.callMethod as (...a: unknown[]) => void)(...args);
    else fbq.queue!.push(args);
  };
  Object.assign(fbq, { push: fbq, loaded: true, version: "2.0", queue: [] as unknown[] });
  window.fbq = fbq;
  window._fbq = fbq;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  // No automatic events: the Pixel sends only what Analytics names (no button scraping).
  fbq("set", "autoConfig", false, pixelId);
  fbq("consent", "grant");
  fbq("init", pixelId);
}
