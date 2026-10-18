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
import { ButtonLink } from "@/ui/Button";
import { Confirmation } from "@/ui/Confirmation";
import { InfoBox, Kicker, PageTitle, Screen } from "@/ui/layout";
import { TopProgress } from "@/ui/shell/TopProgress";
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
  const tf = await getTranslations("flow");
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
    const index = ["when", "scope", "channel"].indexOf(step);
    return (
      <Screen>
        <TopProgress percent={((index + 1) / 5) * 100} />
        <p className="text-[15px] font-bold text-lime">
          {t("newTitle")} · {tf("stepOf", { n: index + 1, m: 3 })}
        </p>
        <RadarSetup
          state={state}
          step={step}
          brand={product?.brand ?? ""}
          modelCode={product?.modelCode ?? ""}
          description={product ? product.name : null}
        />
      </Screen>
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
      <Screen size="narrow" gap="gap-4">
        <TopProgress percent={80} />
        <Kicker>{t("planKicker")}</Kicker>
        <PageTitle>{t("planTitle")}</PageTitle>
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
            features={[t("feature1"), t("feature2"), t("feature3")]}
            legal={t.rich("legalNote", {
              terms: (chunks) => (
                <Link href="/noteikumi" className="text-mist underline">
                  {chunks}
                </Link>
              ),
            })}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <InfoBox>{t("paymentsOff")}</InfoBox>
            <div>
              <ButtonLink href="/izvelies" variant="outline">
                {t("backToResults")}
              </ButtonLink>
            </div>
          </div>
        )}
      </Screen>
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
    <Confirmation title={t("confirmTitle")} body={t("confirmBody")}>
      <ButtonLink href="/radars">{t("toRadar")}</ButtonLink>
      <ButtonLink href="/izvelies" variant="outline">
        {t("backToResults")}
      </ButtonLink>
    </Confirmation>
  );
}

function plansActive() {
  return eq(plans.active, true);
}
