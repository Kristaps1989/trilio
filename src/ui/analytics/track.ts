// Events that happen after the server answers, not on a click (a confirmed
// save). The Analytics component forwards them to GA4 and, for conversions,
// to Google Ads; without consent nothing listens and nothing is sent.

export const TRACK_EVENT = "trilio:track";

export type TrackDetail = { event: string; params?: Record<string, string> };

export function track(event: string, params?: Record<string, string>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TrackDetail>(TRACK_EVENT, { detail: { event, params } }));
}
