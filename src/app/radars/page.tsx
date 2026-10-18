import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { auth, enabledProviders, signOut } from "@/auth";
import { accounts, db, plans, stores } from "@/db";
import { listRadars } from "@/db/queries/radar";
import { currentSubscription } from "@/services/billing/engine";
import { pushPublicKey } from "@/services/notify/push";
import { Button, ButtonLink } from "@/ui/Button";
import { Kicker, Page, PageTitle, Panel, Screen } from "@/ui/layout";
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
      <Screen size="narrow">
        <Kicker>{t("kicker")}</Kicker>
        <PageTitle>{t("signedOutTitle")}</PageTitle>
        <p className="-mt-1 text-[17px] leading-normal text-stone">
          {t("signedOut")} {t("sub")}
        </p>
        <div>
          <ButtonLink href="/ienakt?callbackUrl=/radars" size="lg">
            {ta("title")}
          </ButtonLink>
        </div>
      </Screen>
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
    <Page size="text">
      <div className="flex flex-col gap-2">
        <Kicker>{t("headline", { count: cards.length })}</Kicker>
        <PageTitle scale="results">{t("title")}</PageTitle>
        <p className="text-[17px] text-stone">{t("sub")}</p>
      </div>

      {cards.length === 0 ? (
        <Panel tone="dashed" className="text-lg">
          {t("empty")}
        </Panel>
      ) : (
        <ul className="flex flex-col gap-[18px]">
          {cards.map((c) => (
            <li key={c.id}>
              <RadarCard radar={c} stores={storeRows} />
            </li>
          ))}
        </ul>
      )}

      {pushKey && cards.some((c) => c.channels.includes("push")) ? (
        <Panel className="flex flex-col gap-2">
          <h2 className="font-heading text-xl font-semibold text-mist">{t("howNotify")}</h2>
          <PushToggle publicKey={pushKey} />
        </Panel>
      ) : null}

      <Panel className="flex flex-col gap-[14px]">
        <h2 className="font-heading text-xl font-semibold text-mist">{t("subscription")}</h2>
        <SubscriptionPanel subscription={subscription} />
      </Panel>

      <section
        aria-label={t("account")}
        className="flex flex-wrap items-center justify-between gap-3 px-0.5 py-1 text-[15px] text-stone"
      >
        <span>{t("accountLine", { email: session.user?.email ?? "", provider: providerLabel })}</span>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/konts" variant="outline" size="sm">
            {t("account")}
          </ButtonLink>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <Button type="submit" variant="outline" size="sm">
              {ta("signOut")}
            </Button>
          </form>
        </div>
      </section>
    </Page>
  );
}
