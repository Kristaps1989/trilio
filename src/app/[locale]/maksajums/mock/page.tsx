import { redirect } from "next/navigation";
import { z } from "zod";
import { mockComplete } from "@/services/payments/mock";
import { appBaseUrl, paymentsProvider } from "@/services/payments";
import { Button } from "@/ui/Button";
import { PageTitle, Screen } from "@/ui/layout";
import { localPath } from "@/i18n/path";

// Fake hosted checkout used only with PAYMENTS_PROVIDER=mock (dev and CI).
// "Maksāt" records a captured notification and delivers it to our own
// callback route exactly like Paysera would, then redirects to accept_url.

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ request?: string; accept?: string; cancel?: string }> };

const Local = z.string().refine((u) => u.startsWith(appBaseUrl() + "/"), "same-origin only");

export default async function MockCheckout({ searchParams }: Props) {
  const provider = paymentsProvider();
  const { request, accept, cancel } = await searchParams;
  if (!provider || provider.name !== "mock" || !request) redirect(await localPath("/"));
  const acceptUrl = Local.safeParse(accept).success ? accept! : "/velmju-saraksts";
  const cancelUrl = Local.safeParse(cancel).success ? cancel! : "/velmju-saraksts";

  async function complete(formData: FormData) {
    "use server";
    const outcome = formData.get("outcome") === "cancel" ? "canceled" : "captured";
    const notificationId = mockComplete(request!, outcome);
    if (notificationId) {
      await fetch(`${appBaseUrl()}/api/payments/callback`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ notification_id: notificationId }).toString(),
      }).catch(() => undefined);
    }
    redirect(await localPath(outcome === "captured" ? acceptUrl : cancelUrl));
  }

  return (
    <Screen size="narrow">
      <PageTitle>Mock checkout</PageTitle>
      <p className="text-base text-stone">Testa maksājumu lapa (tikai izstrādei). Request: {request}</p>
      <form action={complete} className="flex flex-wrap gap-3">
        <Button type="submit" name="outcome" value="pay">
          Maksāt (tests)
        </Button>
        <Button type="submit" name="outcome" value="cancel" variant="outline">
          Atcelt
        </Button>
      </form>
    </Screen>
  );
}
