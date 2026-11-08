import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { after } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { auth, currentUserId } from "@/auth";
import { isAdminEmail, offerSignature } from "@/config/admin";
import { savingsProofText } from "@/services/offers/proof";
import { db, offers, stores } from "@/db";
import { loadProduct } from "@/db/queries/catalog";
import { savedKeys } from "@/db/queries/wishlist";
import { clickSuspicion, signalsOf } from "@/domain/analytics/click-quality";
import { withSource } from "@/domain/analytics/click-source";
import { isBot } from "@/domain/analytics/visits";
import { displayName } from "@/domain/catalog/naming";
import { trilioSources } from "@/domain/offers/sourcing";
import { productKey } from "@/domain/wishlist/wishlist";
import { formatEur } from "@/i18n/format";
import { recordUiEvent } from "@/services/notify/events";
import { Container } from "@/ui/layout";
import { NOINDEX } from "../../seo";
import { AskPage } from "./AskPage";

// The question before the shop as a page (docs/CLICK_QUALITY_PLAN.md §2). /go/
// sends a card's "Pirkt" click here when no answer from the last day is
// remembered: the click came before the results page's script was ready, or
// from a client that never runs it. Nothing is counted as a shop click until
// "Uz {Shop}" is followed. Never indexed.

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ offerId: string }>;
  searchParams: Promise<{ s?: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ask");
  return { title: t("title"), robots: NOINDEX };
}

export default async function BeforeShopPage({ params, searchParams }: Props) {
  const id = z
    .string()
    .uuid()
    .safeParse((await params).offerId);
  if (!id.success) notFound();
  const [row] = await db
    .select({ productId: offers.productId })
    .from(offers)
    .innerJoin(stores, eq(stores.id, offers.storeId))
    .where(and(eq(offers.id, id.data), eq(stores.active, true)));
  const product = row ? await loadProduct(db, row.productId) : null;
  const offer = product?.offers.find((o) => o.id === id.data);
  if (!product || !offer) notFound();

  const t = await getTranslations("ask");
  const tp = await getTranslations("productType");
  const typeLabel = tp.has(product.subcategoryId as "fridge") ? tp(product.subcategoryId as "fridge") : "";
  const name = displayName(product.name, product.brand, product.subcategoryId, typeLabel, product.modelCode);
  const s = z
    .string()
    .uuid()
    .safeParse((await searchParams).s);
  const shopHref = withSource(`/go/${offer.id}${s.success ? `?s=${s.data}` : ""}`, "ask");
  const userId = await currentUserId();
  const saved = (await savedKeys(db, userId, [productKey(product.id)])).has(productKey(product.id));
  const proof = await savingsProofText(db);
  const sourced = trilioSources(product.subcategoryId);

  // Shown to a shopper: counted as the question shown, as the sheet counts it. Bots and suspect requests are not.
  const h = await headers();
  const userAgent = h.get("user-agent");
  const person =
    !isBot(userAgent) &&
    clickSuspicion({ userAgent, signals: signalsOf(h), source: "card", pageViewed: true }) === null;
  if (person) {
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
    const internal = isAdminEmail((await auth().catch(() => null))?.user?.email ?? "");
    if (!internal)
      after(() =>
        recordUiEvent(db, { ip, userAgent }, "ask_shown", product.subcategoryId).catch(() => undefined),
      );
  }

  return (
    <Container size="text" className="flex flex-col gap-4 py-6">
      <section
        aria-labelledby="ask-title"
        className="flex flex-col gap-3 rounded-[22px] bg-white px-5 pt-5 pb-6 text-night"
        data-ask-page
      >
        <h1 id="ask-title" className="font-heading text-[22px] leading-tight font-semibold">
          {t(sourced ? "title" : "titlePlain")}
        </h1>
        <p className="text-[15px] font-semibold">
          {t("product", { name, price: formatEur(offer.priceCents), shop: offer.storeName })}
        </p>
        <AskPage
          target={{ kind: "product", productId: product.id }}
          saved={saved}
          offers={sourced}
          priceCents={offer.priceCents}
          shop={offer.storeName}
          shopHref={shopHref}
          signedIn={!!userId}
          signer={offerSignature()}
          proof={proof}
        />
      </section>
    </Container>
  );
}
