"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

// Counts a page view for Trilio's own statistics, without cookies or any
// identifier stored on the device (docs/ADMIN_AND_OFFERS_PLAN.md §3). Only the
// path and the category parameter are sent; answers and free text are not.

export function VisitBeacon() {
  const pathname = usePathname();
  const sub = useSearchParams().get("sub");
  useEffect(() => {
    const path = sub && /^[a-z][a-z0-9_-]{0,40}$/.test(sub) ? `${pathname}?sub=${sub}` : pathname;
    const body = JSON.stringify({ path });
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
  }, [pathname, sub]);
  return null;
}
