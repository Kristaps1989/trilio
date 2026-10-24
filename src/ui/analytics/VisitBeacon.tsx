"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { AD_KEYS } from "@/domain/growth/attribution";

// Counts a page view for Trilio's own statistics, without cookies or any
// identifier stored on the device (docs/ADMIN_AND_OFFERS_PLAN.md §3). Only the
// path and the category parameter are sent; answers and free text are not.
// A landing from an ad also sends Google's click id and the campaign tags
// (docs/GROWTH_PLAN.md, Phase 0), so the admin can tell which ads bring
// shop clicks and saves.

export function VisitBeacon() {
  const pathname = usePathname();
  const params = useSearchParams();
  const sub = params.get("sub");
  const ad = AD_KEYS.map((k) => [k, params.get(k)] as const).filter(([, v]) => v);
  const adKey = ad.map(([k, v]) => `${k}=${v}`).join("&");
  useEffect(() => {
    const path = sub && /^[a-z][a-z0-9_-]{0,40}$/.test(sub) ? `${pathname}?sub=${sub}` : pathname;
    const body = JSON.stringify(
      adKey ? { path, ad: Object.fromEntries(new URLSearchParams(adKey)) } : { path },
    );
    try {
      if (!navigator.sendBeacon?.("/api/visit", new Blob([body], { type: "application/json" })))
        void fetch("/api/visit", {
          method: "POST",
          body,
          keepalive: true,
          headers: { "content-type": "application/json" },
        });
    } catch {
      // Statistics never break a page.
    }
  }, [pathname, sub, adKey]);
  return null;
}
