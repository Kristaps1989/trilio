import { redirect } from "next/navigation";
import { localPath } from "@/i18n/path";

// The paid price-alert plan is retired (owner, 24 Oct 2026): price-drop e-mails
// are free and on by default for saved items (docs/TRUST_POLISH_PLAN.md §1).
// Old links land on the wishlist, where the setting lives.

export const dynamic = "force-dynamic";

export default async function NotifyPlanPage(): Promise<never> {
  redirect(await localPath("/velmju-saraksts"));
}
