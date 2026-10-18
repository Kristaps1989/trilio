import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, plans } from "@/db";
import { loadProduct } from "@/db/queries/catalog";
import { currentSubscription, hasAccess } from "@/services/billing/engine";
import { formatEur } from "@/i18n/format";
import { paymentsEnabled } from "@/services/payments";
import Link from "next/link";
import { PrimaryLink } from "@/ui/PrimaryButton";
import { Shell } from "@/ui/Shell";
import { createRadarAction } from "../actions";
import { PlanPicker } from "./PlanPicker";
import { RadarSetup, type SetupState } from "./RadarSetup";

export const dynamic = "force-dynamic";

const Params = z.object({
  product: z.string().uuid().optional(),
  s: z.string().uuid().optional().or(z.literal("")).optional(),
  threshold: z.enum(["any", "5", "10"]).optional(),
  scope: z.enum(["only", "brand", "any"]).optional(),
  channels: z.string().optional(),
  step: z.enum(["when", "scope", "channel", "plan", "create"]).optional(),
});

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("radar");
  return { title: t("newTitle") };
}

function selfUrl(state: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v) p.set(k, v);
  return `/radars/jauns?${p.toString()}`;
}

/**
 * Spec §5.1: when → scope → channel → sign in → plan → pay → confirmation.
 * State lives in the URL so the browser back button and the payment
 * redirect both bring the shopper back to the right step.
 */
export default async function NewRadarPage({ searchParams }: Props) {
  const raw = await searchParams;
  const t = await getTranslations("radar");
  const parsed = Params.safeParse(raw);
  const p = parsed.success ? parsed.data : {};
  const channels = (p.channels ?? "")
    .split(",")
    .filter((c): c is "push" | "email" => c === "push" || c === "email");
  const product = p.product ? await loadProduct(db, p.product) : null;

  const state: SetupState = {
    productId: product?.id ?? null,
    searchSessionId: p.s || null,
    threshold: p.threshold ?? null,
    scope: p.scope ?? null,
    channels,
  };
  const current = selfUrl({ ...raw, step: undefined });

  // Which step are we on?
  // An explicit step=plan (e.g. "Ieslēgt radaru" on the radar page) goes straight to the plan screen.
  const step =
    p.step === "plan"
      ? "plan"
      : p.step && p.step !== "create"
        ? p.step
        : !state.threshold
          ? "when"
          : !state.scope
            ? "scope"
            : channels.length === 0
              ? "channel"
              : "gate";

  if (step === "when" || step === "scope" || step === "channel") {
    return (
      <Shell>
        <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">{t("newTitle")}</h1>
        {product ? <p className="mt-1 text-sm text-stone">{product.name}</p> : null}
        <RadarSetup
          state={state}
          step={step}
          brand={product?.brand ?? ""}
          modelCode={product?.modelCode ?? ""}
        />
      </Shell>
    );
  }

  // Sign-in gate (spec §5.1 step 4): signed-in users skip it.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect(`/ienakt?callbackUrl=${encodeURIComponent(current)}`);

  // Plan + payment (step 5–6): subscribed users skip it.
  const sub = await currentSubscription(db, userId);
  if (!hasAccess(sub) || step === "plan") {
    if (hasAccess(sub)) redirect(current); // asked for the plan but already subscribed
    const list = await db.select().from(plans).where(plansActive());
    const monthly = list.find((x) => x.interval === "month");
    const annual = list.find((x) => x.interval === "year");
    return (
      <Shell>
        <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">{t("planTitle")}</h1>
        <p className="mt-2 text-base text-stone">{t("planFeatures")}</p>
        {paymentsEnabled() && monthly && annual ? (
          <PlanPicker
            monthly={{ id: monthly.id, label: t("planMonthly", { price: formatEur(monthly.priceCents) }) }}
            annual={{
              id: annual.id,
              label: t("planAnnual", { price: formatEur(annual.priceCents) }),
              sublabel: t("planAnnualSub"),
            }}
            returnTo={`${current}&step=create`}
            payLabel={t("pay")}
            note={t("payNote")}
            legal={t.rich("legalNote", {
              terms: (chunks) => (
                <Link href="/noteikumi" className="text-mist underline">
                  {chunks}
                </Link>
              ),
            })}
          />
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            <p className="text-base text-mist">{t("paymentsOff")}</p>
            <PrimaryLink href="/cits" variant="secondary">
              {t("backToResults")}
            </PrimaryLink>
          </div>
        )}
      </Shell>
    );
  }

  // Create (after payment or for subscribed users): then confirmation.
  if (!state.productId) redirect("/radars");
  const created = await createRadarAction({
    productId: state.productId,
    searchSessionId: state.searchSessionId,
    threshold: state.threshold!,
    scope: state.scope!,
    channels,
  });
  if (!created.ok) redirect("/radars");
  return (
    <Shell back={false}>
      <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">{t("confirmTitle")}</h1>
      <p className="mt-2 text-base text-stone">{t("confirmBody")}</p>
      <div className="mt-6 flex flex-col gap-3">
        <PrimaryLink href="/radars">{t("toRadar")}</PrimaryLink>
        <PrimaryLink href="/izvelies" variant="secondary">
          {t("backToResults")}
        </PrimaryLink>
      </div>
    </Shell>
  );
}

function plansActive() {
  return eq(plans.active, true);
}
