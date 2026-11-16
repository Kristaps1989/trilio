import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { isAdminEmail, offerSignature } from "@/config/admin";
import { db } from "@/db";
import { loadProduct } from "@/db/queries/catalog";
import { deliveryBy, offerPhase, savingClaim } from "@/domain/offers/offers";
import { formatDateDative, formatEur } from "@/i18n/format";
import { activeLocale } from "@/i18n/active";
import { signatureLine } from "@/services/offers/compose";
import { markOpened, offerByToken } from "@/services/offers/offers";
import { comparisonWords } from "@/services/offers/alternative";
import { imagePath, imagesOfSet } from "@/services/offers/images";
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
  const t = await getTranslations("offer");
  return { title: offer?.productName ?? t("boxLabel"), robots: { index: false, follow: false } };
}

export default async function OfferPage({ params }: Props) {
  const { token } = await params;
  const t = await getTranslations("offer");
  const tr = await getTranslations("results");
  const ta = await getTranslations("answerEmail");
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
        <PageTitle>
          <span lang="lv">{offer.productName}</span>
        </PageTitle>
        <p className="text-[17px] text-stone" role="status">
          {phase === "paid"
            ? t("paid")
            : phase === "cancelled"
              ? offer.declinedAt
                ? t("declined")
                : t("cancelled")
              : t("expired")}
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
  const lang = activeLocale() === "en" ? "en" : "lv";
  const pictures = await imagesOfSet(db, offer.imageSetId);
  const alternative =
    offer.alternativeToName && offer.comparison
      ? {
          asked: offer.alternativeToName,
          label: offer.comparison.label,
          ...comparisonWords(offer.comparison, offer.subcategoryId, lang),
        }
      : null;
  return (
    <Page size="narrow" gap="gap-5">
      <div className="flex flex-col gap-2">
        <Kicker>{t("kicker")}</Kicker>
        <PageTitle>
          <span lang="lv">{offer.productName}</span>
        </PageTitle>
      </div>

      {alternative ? (
        <section
          aria-labelledby="alt-banner"
          className="flex flex-col gap-1 rounded-card border-[1.5px] border-warning p-4 text-mist"
          data-alternative={alternative.label}
        >
          <h2 id="alt-banner" className="font-heading text-lg font-semibold">
            {t("altBanner")}
          </h2>
          <p className="text-[16px]">{t("altBannerText", { asked: alternative.asked })}</p>
          <p className="text-[15px] text-stone">
            {alternative.label === "equivalent" ? t("altLabelEquivalent") : t("altLabelSimilar")}
          </p>
        </section>
      ) : null}

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
        ) : alternative ? (
          <p className="text-[15px] text-muted">{t("noShopPrice")}</p>
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
            <footer className="mt-1 text-sm text-muted">
              — {signatureLine(offerSignature(), activeLocale())}
            </footer>
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

      {alternative && alternative.rows.length ? (
        <section aria-labelledby="alt-compare" className="flex flex-col gap-3">
          <h2 id="alt-compare" className="font-heading text-xl font-semibold text-mist">
            {ta("compareTitle")}
          </h2>
          <div
            tabIndex={0}
            role="group"
            aria-label={ta("compareTitle")}
            className="overflow-x-auto rounded-card border-[1.5px] border-line-40"
          >
            <table className="w-full min-w-[320px] border-collapse text-left text-[15px] text-mist">
              <caption className="sr-only">{ta("compareTitle")}</caption>
              <thead>
                <tr className="border-b border-line-25 text-sm text-stone">
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {ta("colAttr")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {ta("colAsked")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {ta("colOffered")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {alternative.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line-20 last:border-0">
                    <th scope="row" className="px-3 py-2 font-semibold">
                      {r.label}
                    </th>
                    <td className="px-3 py-2 text-stone">{r.asked}</td>
                    <td className="px-3 py-2">
                      {r.offered}
                      {r.verdict ? (
                        <span
                          className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[13px] font-bold ${
                            r.verdict.tone === "good"
                              ? "bg-lime text-night"
                              : r.verdict.tone === "bad"
                                ? "bg-warning text-night"
                                : "bg-chip text-mist"
                          }`}
                        >
                          {r.verdict.text}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {alternative.downsides.length ? (
            <p className="text-[15px] text-mist">
              {ta("downsides", { list: alternative.downsides.join("; ") })}
            </p>
          ) : null}
        </section>
      ) : null}

      {offer.description ? (
        <section
          aria-labelledby="trilio-description"
          className="flex flex-col gap-2 rounded-card bg-card-soft p-5 text-night"
        >
          <h2 id="trilio-description" className="text-sm font-bold tracking-wide uppercase text-muted">
            {t("descriptionTitle")}
          </h2>
          <p className="text-[16px] whitespace-pre-line">{offer.description}</p>
        </section>
      ) : null}

      {pictures.length ? (
        <section aria-label={t("product")} className="flex flex-col gap-3">
          <ul className="grid grid-cols-2 gap-3">
            {pictures.map((p, i) => (
              <li key={p.id} className={i === 0 ? "col-span-2" : ""}>
                {/* eslint-disable-next-line @next/next/no-img-element -- Trilio's own stored copy */}
                <img
                  src={imagePath(p.id)}
                  alt={p.alt}
                  width={p.width}
                  height={p.height}
                  className="h-auto w-full rounded-card bg-white object-contain"
                  data-offer-picture
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {alternative ? (
        <div className="flex flex-col gap-2">
          <p className="text-[15px] text-stone">{ta("declineHint")}</p>
          <ButtonLink
            href={`/piedavajums/${token}/atteikt`}
            variant="outline"
            data-testid="decline-alternative"
          >
            {t("decline")}
          </ButtonLink>
        </div>
      ) : null}

      {product && media ? (
        <section
          aria-label={t("product")}
          className="flex flex-col gap-3 rounded-card border-[1.5px] border-line-40 p-5"
        >
          {pictures.length ? null : (
            <ProductImage
              src={media.image.src}
              alt={product.name}
              fallback={media.image.fallback}
              size="card"
            />
          )}
          <p className="font-heading text-sm font-semibold text-stone">
            {tr("model", { code: product.modelCode, ean: product.ean ?? "—" })}
          </p>
          {product.specs ? <p className="text-[15px] text-mist">{product.specs}</p> : null}
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
