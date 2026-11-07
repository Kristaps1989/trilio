"use client";

import { ASK_COOKIE, askAnswered, ASK_TTL_MS, cookieValue } from "@/domain/analytics/ask-cookie";

// The shopper's answer to the question before the shop, shared by every shop
// link on the page and by /go/ on the server (docs/CLICK_QUALITY_PLAN.md §2):
// a first-party functional cookie for 24 hours. Storage blocked: the question
// is simply asked again.

const listeners = new Set<() => void>();

export function subscribeAnswer(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function answered(): boolean {
  try {
    return askAnswered(cookieValue(document.cookie));
  } catch {
    return false;
  }
}

export function rememberAnswer() {
  try {
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${ASK_COOKIE}=${Date.now()}; max-age=${ASK_TTL_MS / 1000}; path=/; samesite=lax${secure}`;
  } catch {
    /* cookies blocked: the question is simply asked again */
  }
  for (const l of listeners) l();
}
