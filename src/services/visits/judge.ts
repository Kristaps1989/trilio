import { auth } from "@/auth";
import { isAdminEmail } from "@/config/admin";
import { requestSuspicion, signalsOf } from "@/domain/analytics/click-quality";

// Whether a request's visitor day should be left out of the statistics
// (docs/CLICK_QUALITY_PLAN.md §6): "internal" for an admin's own browsing,
// a suspect reason for a request that is not a person's browser, else null.

export async function judgeRequest(h: Headers, kind: "page" | "beacon" = "page"): Promise<string | null> {
  if (/authjs\.session-token/.test(h.get("cookie") ?? "")) {
    const email = (await auth().catch(() => null))?.user?.email ?? "";
    if (isAdminEmail(email)) return "internal";
  }
  return requestSuspicion(h.get("user-agent"), signalsOf(h), kind);
}
