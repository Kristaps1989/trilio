import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isAdminEmail, offerSignature } from "@/config/admin";
import { db } from "@/db";
import { loadProduct } from "@/db/queries/catalog";
import { deliveryBy, offerPhase, savingClaim } from "@/domain/offers/offers";
import { formatDateDative, formatEur, formatRating } from "@/i18n/format";
import { markOpened, offerByToken } from "@/services/offers/offers";
import { orderOfOffer } from "@/services/offers/orders";
import { Button, ButtonLink } from "@/ui/Button";
import { EnergyBadge } from "@/ui/EnergyBadge";
import { Kicker, Page, PageTitle } from "@/ui/layout";
import { ProductImage } from "@/ui/ProductImage";
import { cardMedia } from "../../rezultati/card-media";
import { acceptOfferAction } from "./actions";

// The offer page (docs/ADMIN_AND_OFFERS_PLAN.md §11.2): one screen, one
// decision. The price large, the saving in one sentence when it is true, the
// delivery promise with a date, the warranty, why it is cheaper, one button.
// Below, the product facts the shopper already knows from Trilio.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const offer = await offerByToken(db, (await params).token);
  return { title: offer?.productName ?? "Piedāvājums", robots: { index: false, follow: false } };
}

export default async function OfferPage({ params }: Props) {
  const { token } = await params;
  const t = await getTranslations("offer");
  const tr = await getTranslations("results");
  const offer = await offerByToken(db, token);
  if (!offer || offer.status === "draft") notFound();
  const session = await auth();
  const now = new Date();
  const phase = offerPhase(offer, now);
  // The admin checking the link does not count as the recipient opening it.
  if (phase === "open" && !isAdminEmail(session?.user?.email)) await markOpened(db, offer, now);
  const [product, order] = await Promise.all([
    offer.productId ? loadProduct(db, offer.productId) : null,
    orderOfOffer(db, offer.id),
  ]);
  const media = product ? cardMedia(product) : null;
  const claim = savingClaim(offer.priceCents, {
    priceCents: offer.referencePriceCents,
    low30Cents: offer.referenceLow30Cents,
  });
  const yours = session?.user?.id === offer.userId;

  if (phase !== "open") {
    return (
      <Page size="narrow">
        <Kicker>{t("kicker")}</Kicker>
        <PageTitle>{offer.productName}</PageTitle>
        <p className="text-[17px] text-stone" role="status">
          {phase === "paid" ? t("paid") : phase === "cancelled" ? t("cancelled") : t("expired")}
        </p>
        <div className="flex flex-wrap gap-3">
          {phase === "paid" && yours && order ? (
            <ButtonLink href={`/konts/pasutijumi/${order.id}`}>{t("openOrder")}</ButtonLink>
          ) : null}
          {product ? (
            <ButtonLink href={`/modelis?q=${encodeURIComponent(product.modelCode)}`} variant="outline">
              {t("shopOffers")}
            </ButtonLink>
          ) : null}
        </div>
      </Page>
    );
  }

  const awaitingPayment = order?.status === "awaiting_payment";
  return (
    <Page size="narrow" gap="gap-5">
      <div className="flex flex-col gap-2">
        <Kicker>{t("kicker")}</Kicker>
        <PageTitle>{offer.productName}</PageTitle>
      </div>

      <section
        aria-label={t("boxLabel")}
        className="flex flex-col gap-3 rounded-card bg-white p-[22px] text-night shadow-[0_0_0_3px_var(--color-lime)]"
      >
        <p
          className="font-heading text-[46px] leading-none font-bold tracking-[-0.02em]"
          data-price-cents={offer.priceCents}
        >
          {formatEur(offer.priceCents)}
        </p>
        {claim ? (
          <p className="text-[17px] font-bold text-success">
            {t("saving", { saving: formatEur(claim.savingCents) })}
          </p>
        ) : null}
        {offer.referencePriceCents !== null ? (
          <p className="text-[15px] text-muted">
            {t("shops", { price: formatEur(offer.referencePriceCents) })}
          </p>
        ) : null}
        <ul className="flex flex-col gap-1.5 text-[16px]">
          <li>{t("delivery", { date: formatDateDative(deliveryBy(now, offer.deliveryWorkingDays)) })}</li>
          <li>
            {offer.condition === "refurbished"
              ? t("refurbished", { grade: offer.grade ?? "", months: offer.warrantyMonths })
              : t("warranty", { months: Math.max(24, offer.warrantyMonths) })}
          </li>
          <li className="text-muted">{t("why")}</li>
        </ul>
        {offer.message ? (
          <blockquote className="rounded-control bg-card-soft px-4 py-3 text-[15px]">
            <p className="whitespace-pre-line">{offer.message}</p>
            <footer className="mt-1 text-sm text-muted">— {offerSignature()}, Trilio</footer>
          </blockquote>
        ) : null}
        {yours || !session?.user ? (
          <form action={acceptOfferAction}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" size="lg" block variant="dark">
              {awaitingPayment ? t("continue") : t("accept")}
            </Button>
          </form>
        ) : (
          <p className="text-[15px] text-muted" role="status">
            {t("notYours")}
          </p>
        )}
        <p className="text-sm text-muted">{t("valid", { date: formatDateDative(offer.validUntil) })}</p>
      </section>

      {product && media ? (
        <section
          aria-label={t("product")}
          className="flex flex-col gap-3 rounded-card border-[1.5px] border-line-40 p-5"
        >
          <ProductImage
            src={media.image.src}
            alt={product.name}
            fallback={media.image.fallback}
            size="card"
          />
          <p className="font-heading text-[13px] font-semibold text-stone">
            {tr("model", { code: product.modelCode, ean: product.ean ?? "—" })}
          </p>
          {product.specs ? <p className="text-[15px] text-mist">{product.specs}</p> : null}
          {product.rating !== null ? (
            <p className="text-[15px] text-mist">
              {tr("rating", { score: formatRating(product.rating / 10) })}
            </p>
          ) : null}
          {media.energyLabel ? (
            <div className="rounded-control bg-white p-3 text-night">
              <EnergyBadge label={media.energyLabel} />
            </div>
          ) : null}
        </section>
      ) : null}

      <p className="text-sm text-stone">
        {t.rich("terms", {
          link: (chunks) => (
            <Link href="/pirkuma-noteikumi" className="text-mist underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </Page>
  );
}
