import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { auth, enabledProviders, signOut } from "@/auth";
import { accounts, db, plans, stores } from "@/db";
import { listRadars } from "@/db/queries/radar";
import { currentSubscription } from "@/services/billing/engine";
import { pushPublicKey } from "@/services/notify/push";
import { PrimaryButton, PrimaryLink } from "@/ui/PrimaryButton";
import { Shell } from "@/ui/Shell";
import { PushToggle } from "./PushToggle";
import { RadarCard, type RadarCardModel } from "./RadarCard";
import { SubscriptionPanel, type SubscriptionModel } from "./SubscriptionPanel";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("radar");
  return { title: t("title") };
}

/** Spec §5.2: the radar page. Signed out, only the sign-in buttons show. */
export default async function RadarPage() {
  const t = await getTranslations("radar");
  const ta = await getTranslations("auth");
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return (
      <Shell>
        <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">{t("title")}</h1>
        <p className="mt-2 text-base text-stone">{t("signedOut")}</p>
        <div className="mt-6">
          <PrimaryLink href="/ienakt?callbackUrl=/radars">{ta("title")}</PrimaryLink>
        </div>
      </Shell>
    );
  }

  const [items, sub, storeRows, account] = await Promise.all([
    listRadars(db, userId),
    currentSubscription(db, userId),
    db.select({ id: stores.id, name: stores.displayName }).from(stores).where(eq(stores.active, true)),
    db.select({ provider: accounts.provider }).from(accounts).where(eq(accounts.userId, userId)).limit(1),
  ]);
  const plan = sub ? (await db.select().from(plans).where(eq(plans.id, sub.planId)))[0] : undefined;

  const cards: RadarCardModel[] = items.map((i) => ({
    id: i.radar.id,
    name: i.product.name,
    brand: i.product.brand,
    modelCode: i.product.modelCode,
    ean: i.product.ean,
    paused: i.radar.paused,
    threshold: i.radar.threshold,
    scope: i.radar.scope,
    storeIds: i.radar.storeIds,
    includeRefurbished: i.radar.includeRefurbished,
    channels: i.radar.channels as ("push" | "email")[],
    currentPriceCents: i.currentPriceCents,
    currentStoreName: i.currentStoreName,
    baselinePriceCents: i.radar.baselinePriceCents,
    sparkline: i.sparkline,
  }));

  const subscription: SubscriptionModel | null = sub
    ? {
        status: sub.status,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        nextBillingAt: sub.nextBillingAt?.toISOString() ?? null,
        paymentMethodLabel: sub.paymentMethodLabel,
        planName: plan?.name ?? sub.planId,
      }
    : null;

  const providerLabel = account[0]?.provider ?? (enabledProviders.dev ? "dev" : "e-pasts");
  const pushKey = pushPublicKey();

  return (
    <Shell>
      <h1 className="pt-4 text-[28px] font-bold leading-[1.2] text-mist">{t("title")}</h1>

      {cards.length === 0 ? (
        <p className="mt-4 text-base text-stone">{t("empty")}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {cards.map((c) => (
            <li key={c.id}>
              <RadarCard radar={c} stores={storeRows} />
            </li>
          ))}
        </ul>
      )}

      {pushKey && cards.some((c) => c.channels.includes("push")) ? (
        <section className="mt-6" aria-label={t("channels")}>
          <h2 className="text-lg font-bold text-mist">{t("channels")}</h2>
          <div className="mt-2">
            <PushToggle publicKey={pushKey} />
          </div>
        </section>
      ) : null}

      <section className="mt-8" aria-label={t("subscription")}>
        <h2 className="text-lg font-bold text-mist">{t("subscription")}</h2>
        <div className="mt-2">
          <SubscriptionPanel subscription={subscription} />
        </div>
      </section>

      <section className="mt-8 flex flex-col gap-3" aria-label={t("account")}>
        <h2 className="text-lg font-bold text-mist">{t("account")}</h2>
        <p className="text-sm text-stone">
          {t("accountLine", { email: session.user?.email ?? "", provider: providerLabel })}
        </p>
        <div className="flex gap-3">
          <form
            className="flex-1"
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <PrimaryButton type="submit" variant="secondary">
              {ta("signOut")}
            </PrimaryButton>
          </form>
          <PrimaryLink href="/konts" variant="secondary" className="flex-1">
            {t("account")}
          </PrimaryLink>
        </div>
      </section>
    </Shell>
  );
}
