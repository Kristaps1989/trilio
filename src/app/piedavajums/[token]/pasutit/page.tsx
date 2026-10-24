import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { db, offerOrders, users } from "@/db";
import { canAccept, deliveryBy, deliveryOptions } from "@/domain/offers/offers";
import { formatDateDative, formatEur } from "@/i18n/format";
import { omnivaLockers } from "@/services/offers/lockers";
import { offerByToken } from "@/services/offers/offers";
import { orderOfOffer } from "@/services/offers/orders";
import { paymentsEnabled } from "@/services/payments";
import { InfoBox, Kicker, PageTitle, Screen } from "@/ui/layout";
import { CheckoutForm } from "./CheckoutForm";

// Checkout for an accepted offer: the recipient only, while the offer is open.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pasūtījums", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ atcelts?: string }> };

export default async function CheckoutPage({ params, searchParams }: Props) {
  const { token } = await params;
  const t = await getTranslations("checkout");
  const offer = await offerByToken(db, token);
  const session = await auth();
  if (!offer || !session?.user?.id || session.user.id !== offer.userId || !canAccept(offer, new Date()))
    redirect(`/piedavajums/${token}`);
  const existing = await orderOfOffer(db, offer.id);
  if (existing && existing.status !== "awaiting_payment") redirect(`/konts/pasutijumi/${existing.id}`);

  const options = deliveryOptions(offer.subcategoryId);
  const [lockers, [user], [previous]] = await Promise.all([
    options.locker ? omnivaLockers() : Promise.resolve([]),
    db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, offer.userId!)),
    db
      .select()
      .from(offerOrders)
      .where(eq(offerOrders.userId, offer.userId!))
      .orderBy(desc(offerOrders.createdAt))
      .limit(1),
  ]);
  // Last time's details come back, so a returning buyer only checks them.
  const from = existing ?? previous;
  const amount = formatEur(offer.priceCents);
  const { atcelts } = await searchParams;

  return (
    <Screen size="narrow" gap="gap-4">
      <Kicker>{t("kicker")}</Kicker>
      <PageTitle>{offer.productName}</PageTitle>
      <p className="-mt-1 font-heading text-[28px] font-bold text-mist">{amount}</p>
      {atcelts ? (
        <InfoBox>
          <span role="status">{t("cancelled")}</span>
        </InfoBox>
      ) : null}
      <CheckoutForm
        token={token}
        email={user?.email ?? session.user.email ?? ""}
        amount={amount}
        deliveryLine={t(options.carryIn ? "deliveryLarge" : "deliverySmall", {
          date: formatDateDative(deliveryBy(new Date(), offer.deliveryWorkingDays)),
        })}
        locker={options.locker}
        carryIn={options.carryIn}
        refurbishedGrade={offer.condition === "refurbished" ? (offer.grade ?? "") : null}
        lockers={lockers}
        paymentsOn={paymentsEnabled()}
        defaults={{
          fullName: from?.fullName ?? user?.name ?? "",
          phone: from?.phone ?? "",
          street: from?.street ?? "",
          city: from?.city ?? "",
          postcode: from?.postcode ?? "",
        }}
      />
    </Screen>
  );
}
