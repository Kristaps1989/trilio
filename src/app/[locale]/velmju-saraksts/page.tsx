import { cleanName } from "@/domain/catalog/naming";
import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { auth, signOut } from "@/auth";
import { localPath } from "@/i18n/path";
import { accounts, db, plans } from "@/db";
import { loadCandidates, loadProducts } from "@/db/queries/catalog";
import { getThreshold, listSaved, priceHistory } from "@/db/queries/wishlist";
import type { ProductView } from "@/domain/catalog/types";
import { decodeState } from "@/domain/flow/state";
import { getSubcategory } from "@/domain/questions/catalog";
import { currentOffer, searchProposal } from "@/domain/wishlist/wishlist";
import { formatEur } from "@/i18n/format";
import { currentSubscription, hasAccess } from "@/services/billing/engine";
import { Button, ButtonLink, buttonClass } from "@/ui/Button";
import { InfoBox, Kicker, Page, PageTitle, Panel, Screen } from "@/ui/layout";
import { ProductImage } from "@/ui/ProductImage";
import { OffersConsent } from "@/ui/OffersConsent";
import { PriceAlertsSwitch } from "@/ui/PriceAlertsSwitch";
import { priceAlertsOn } from "@/services/wishlist/alerts";
import { SaveButton } from "@/ui/SaveButton";
import { offersOptIn } from "@/services/offers/offers";
import { cardMedia } from "../rezultati/card-media";
import { PriceHistory } from "./PriceHistory";
import { SubscriptionPanel, type SubscriptionModel } from "./SubscriptionPanel";
import { ThresholdPicker } from "./ThresholdPicker";
import { activeLocale } from "@/i18n/active";

// The wishlist (owner, 20 Oct 2026): saved products and searches with today's
// best offer and the price history, free; e-mails about drops are the paid
// extra. Signed out, only the sign-in prompt shows.

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ apmaksats?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("wishlist");
  return { title: t("title") };
}

export default async function WishlistPage({ searchParams }: Props) {
  const { apmaksats } = await searchParams;
  const t = await getTranslations("wishlist");
  const tr = await getTranslations("results");
  const ta = await getTranslations("auth");
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return (
      <Screen size="narrow">
        <Kicker>{t("title")}</Kicker>
        <PageTitle>{t("signedOutTitle")}</PageTitle>
        <p className="-mt-1 text-[17px] leading-normal text-stone">{t("signedOut")}</p>
        <div>
          <ButtonLink href="/ienakt?callbackUrl=/velmju-saraksts" size="lg">
            {t("signIn")}
          </ButtonLink>
        </div>
      </Screen>
    );
  }

  const [items, sub, threshold, account, offersOn, alertsOn] = await Promise.all([
    listSaved(db, userId),
    currentSubscription(db, userId),
    getThreshold(db, userId),
    db.select({ provider: accounts.provider }).from(accounts).where(eq(accounts.userId, userId)).limit(1),
    offersOptIn(db, userId),
    priceAlertsOn(db, userId),
  ]);
  const plan = sub ? (await db.select().from(plans).where(eq(plans.id, sub.planId)))[0] : undefined;
  const subscribed = hasAccess(sub);

  // Saved products: today's best offer, the change since saving, 90 days of prices.
  const productItems = items.filter((i) => i.kind === "product" && i.productId);
  const products = new Map(
    (
      await loadProducts(
        db,
        productItems.map((i) => i.productId!),
      )
    ).map((p) => [p.id, p]),
  );
  const productCards = await Promise.all(
    productItems.flatMap((i) => {
      const product = products.get(i.productId!);
      if (!product) return [];
      return [
        priceHistory(db, product.id).then((history) => ({
          item: i,
          product,
          offer: currentOffer(product),
          history,
        })),
      ];
    }),
  );

  // Saved searches: what they propose today, ranked exactly like the results page.
  const bySub = new Map<string, ProductView[]>();
  const searchCards = [];
  for (const i of items.filter((x) => x.kind === "search")) {
    const s = getSubcategory(i.subcategoryId, activeLocale());
    if (!s) continue;
    if (!bySub.has(s.id)) bySub.set(s.id, await loadCandidates(db, s.id));
    const proposal = searchProposal(bySub.get(s.id)!, s, decodeState(s, i.answersParam));
    searchCards.push({ item: i, proposal, href: `/rezultati?sub=${s.id}&a=${i.answersParam ?? ""}` });
  }

  const change = (baseline: number | null, now: number | null) => {
    if (baseline === null || now === null) return null;
    if (now < baseline) return { text: t("changeDown", { amount: formatEur(baseline - now) }), good: true };
    if (now > baseline) return { text: t("changeUp", { amount: formatEur(now - baseline) }), good: false };
    return { text: t("changeSame"), good: null };
  };

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
  const email = session.user?.email ?? "";

  return (
    <Page size="text">
      <div className="flex flex-col gap-2">
        <Kicker>{t("kicker", { count: items.length })}</Kicker>
        <PageTitle scale="results">{t("title")}</PageTitle>
        <p className="text-[17px] text-stone">{t("sub")}</p>
      </div>

      {apmaksats && subscribed ? (
        <InfoBox>
          <span role="status">{t("paidBanner")}</span>
        </InfoBox>
      ) : null}

      {items.length === 0 ? (
        <Panel tone="dashed" className="flex flex-col items-start gap-3 text-lg">
          <p>{t("empty")}</p>
          <ButtonLink href="/izvelies" size="sm">
            {t("findProducts")}
          </ButtonLink>
        </Panel>
      ) : null}

      {searchCards.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="searches-title">
          <h2 id="searches-title" className="font-heading text-xl font-semibold text-mist">
            {t("searchesTitle")}
          </h2>
          <ul className="flex flex-col gap-3">
            {searchCards.map(({ item, proposal, href }) => {
              const top = proposal.top;
              const diff = change(item.baselinePriceCents, top?.offer.priceCents ?? null);
              return (
                <li key={item.id}>
                  <article
                    aria-label={item.label ?? item.subcategoryId}
                    className="flex flex-col gap-2 rounded-card border-[1.5px] border-line-40 p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-body text-lg leading-snug font-bold text-mist">
                        {item.label ?? item.subcategoryId}
                      </h3>
                      <SaveButton
                        target={{
                          kind: "search",
                          subcategoryId: item.subcategoryId,
                          answersParam: item.answersParam ?? "",
                          label: item.label ?? item.subcategoryId,
                        }}
                        saved
                        name={item.label ?? item.subcategoryId}
                        variant="icon"
                      />
                    </div>
                    {top ? (
                      <>
                        <p className="text-sm text-stone">{t("searchBest")}</p>
                        <p className="text-base text-mist">
                          <strong lang="lv">
                            {cleanName(top.product.name, top.product.brand, top.product.modelCode)}
                          </strong>{" "}
                          — {formatEur(top.offer.priceCents)} ({top.offer.storeName})
                        </p>
                        <p className="text-sm text-stone">
                          {t("searchCount", { count: proposal.matchingCount })}
                          {diff ? ` · ${diff.text}` : ""}
                        </p>
                      </>
                    ) : (
                      <p className="text-base text-stone">{t("searchNone")}</p>
                    )}
                    <div>
                      <ButtonLink href={href} variant="outline" size="sm">
                        {t("openResults")}
                      </ButtonLink>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {productCards.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="products-title">
          <h2 id="products-title" className="font-heading text-xl font-semibold text-mist">
            {t("productsTitle")}
          </h2>
          <ul className="flex flex-col gap-3">
            {productCards.map(({ item, product, offer, history }) => {
              const diff = change(item.baselinePriceCents, offer?.priceCents ?? null);
              const { image } = cardMedia(product);
              const name = cleanName(product.name, product.brand, product.modelCode);
              return (
                <li key={item.id}>
                  <article
                    aria-label={name}
                    className="flex flex-col gap-3 rounded-card border-[1.5px] border-line-40 p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <ProductImage src={image.src} alt={name} fallback={image.fallback} size="thumb" />
                      <div className="min-w-0 flex-1">
                        <h3 className="font-body text-lg leading-snug font-bold text-mist" lang="lv">
                          {name}
                        </h3>
                        <p className="text-sm text-stone">
                          {tr("model", { code: product.modelCode, ean: product.ean ?? "—" })}
                        </p>
                      </div>
                      <SaveButton
                        target={{ kind: "product", productId: product.id }}
                        saved
                        name={name}
                        variant="icon"
                      />
                    </div>
                    {offer ? (
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <p className="font-heading text-[30px] leading-none font-bold text-mist">
                            {formatEur(offer.priceCents)}
                          </p>
                          <p className="text-sm text-stone">
                            {offer.storeName}
                            {diff ? (
                              <>
                                {" · "}
                                <span className={diff.good ? "text-lime" : undefined}>{diff.text}</span>
                              </>
                            ) : null}
                          </p>
                        </div>
                        <a
                          href={`/go/${offer.id}`}
                          rel="sponsored noopener"
                          className={buttonClass({ variant: "dark", size: "sm" })}
                        >
                          {t("buy", { shop: offer.storeName })}
                        </a>
                      </div>
                    ) : (
                      <p className="text-base text-stone">{t("outOfStock")}</p>
                    )}
                    <PriceHistory
                      points={history}
                      label={t("history")}
                      lowLabel={t("low")}
                      highLabel={t("high")}
                    />
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <Panel className="flex flex-col gap-[14px]" data-price-alerts>
        <h2 className="font-heading text-xl font-semibold text-mist">{t("notifyTitle")}</h2>
        <PriceAlertsSwitch initial={alertsOn} email={email} />
        {alertsOn ? <ThresholdPicker value={threshold} /> : null}
      </Panel>

      <Panel className="flex flex-col gap-[14px]">
        <h2 className="font-heading text-xl font-semibold text-mist">{t("offersTitle")}</h2>
        <OffersConsent initial={offersOn} />
      </Panel>

      {/* Subscriptions bought before the plan was retired can still be seen and cancelled. */}
      {subscription && subscription.status !== "pending" && subscription.status !== "expired" ? (
        <Panel className="flex flex-col gap-[14px]">
          <h2 className="font-heading text-xl font-semibold text-mist">{t("subscription")}</h2>
          <SubscriptionPanel subscription={subscription} />
        </Panel>
      ) : null}

      <section
        aria-label={t("account")}
        className="flex flex-wrap items-center justify-between gap-3 px-0.5 py-1 text-[15px] text-stone"
      >
        <span>{t("accountLine", { email, provider: account[0]?.provider ?? "e-pasts" })}</span>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/konts" variant="outline" size="sm">
            {t("account")}
          </ButtonLink>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: await localPath("/") });
            }}
          >
            <Button type="submit" variant="outline" size="sm">
              {ta("signOut")}
            </Button>
          </form>
        </div>
      </section>
      <p className="text-sm text-stone">
        <Link href="/izvelies" className="underline">
          {t("findProducts")}
        </Link>
      </p>
    </Page>
  );
}
