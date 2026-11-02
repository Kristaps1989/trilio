"use client";

import { useRouter } from "@/i18n/navigation";
import { useEffect } from "react";
import { completePendingRequestAction } from "@/app/[locale]/velmju-saraksts/actions";
import { metaTrack } from "@/ui/analytics/meta";
import { track } from "@/ui/analytics/track";
import { PENDING_PARAM, REQUESTED_EVENT, type RequestedDetail } from "./pendingRequest";

// Back from "Turpināt ar Google": finishes the request for the product the
// shopper chose, then shows that product's card in its requested state. Renders
// nothing; does nothing on any other visit.
export function CompletePendingRequest() {
  const router = useRouter();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PENDING_PARAM)) return;
    url.searchParams.delete(PENDING_PARAM);
    history.replaceState(null, "", url.pathname + url.search);
    void completePendingRequestAction().then((r) => {
      if (!r.ok) return;
      track("save_item", { item: "product" });
      if (r.lead) metaTrack("Lead", {}, r.lead);
      router.refresh();
      window.dispatchEvent(
        new CustomEvent<RequestedDetail>(REQUESTED_EVENT, {
          detail: { productId: r.productId, email: r.email },
        }),
      );
      const show = () => document.getElementById(`p-${r.productId}`)?.scrollIntoView({ block: "center" });
      // After the refresh paints the requested state.
      window.setTimeout(show, 400);
    });
  }, [router]);
  return null;
}
