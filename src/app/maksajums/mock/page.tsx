import { redirect } from "next/navigation";
import { z } from "zod";
import { mockComplete } from "@/services/payments/mock";
import { appBaseUrl, paymentsProvider } from "@/services/payments";
import { PrimaryButton } from "@/ui/PrimaryButton";
import { Shell } from "@/ui/Shell";

// Fake hosted checkout used only with PAYMENTS_PROVIDER=mock (dev and CI).
// "Maksāt" records a captured notification and delivers it to our own
// callback route exactly like Paysera would, then redirects to accept_url.

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ request?: string; accept?: string; cancel?: string }> };

const Local = z.string().refine((u) => u.startsWith(appBaseUrl() + "/"), "same-origin only");

export default async function MockCheckout({ searchParams }: Props) {
  const provider = paymentsProvider();
  const { request, accept, cancel } = await searchParams;
  if (!provider || provider.name !== "mock" || !request) redirect("/");
  const acceptUrl = Local.safeParse(accept).success ? accept! : "/radars";
  const cancelUrl = Local.safeParse(cancel).success ? cancel! : "/radars";

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
    redirect(outcome === "captured" ? acceptUrl : cancelUrl);
  }

  return (
    <Shell back={false}>
      <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">Mock checkout</h1>
      <p className="mt-2 text-base text-stone">Testa maksājumu lapa (tikai izstrādei). Request: {request}</p>
      <form action={complete} className="mt-6 flex flex-col gap-3">
        <PrimaryButton type="submit" name="outcome" value="pay">
          Maksāt (tests)
        </PrimaryButton>
        <PrimaryButton type="submit" name="outcome" value="cancel" variant="secondary">
          Atcelt
        </PrimaryButton>
      </form>
    </Shell>
  );
}
