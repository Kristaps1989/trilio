import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentUserId } from "@/auth";
import { companyFromEnv } from "@/config/company";
import { db } from "@/db";
import {
  canWithdraw,
  carrierById,
  deliveryBy,
  guaranteeMonths,
  withdrawalDeadline,
} from "@/domain/offers/offers";
import { formatDateDative, formatDayLocative, formatEur } from "@/i18n/format";
import { eventsOf } from "@/services/offers/offers";
import { invoicesOf, orderWithOffer } from "@/services/offers/orders";
import { paymentsEnabled } from "@/services/payments";
import { Button, ButtonLink, buttonClass } from "@/ui/Button";
import { InfoBox, Kicker, Page, PageTitle, Panel } from "@/ui/layout";
import { Timeline } from "@/ui/Timeline";
import { confirmDeliveryAction, withdrawAction } from "../actions";

// The order page is the receipt (docs/ADMIN_AND_OFFERS_PLAN.md §11.5): one
// status line in words, the tracking link, the invoice, and the two things
// the buyer may need later: withdrawal and the warranty contact.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pasūtījums", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ apmaksats?: string; gaida?: string }>;
};

export default async function MyOrder({ params, searchParams }: Props) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) redirect(`/ienakt?callbackUrl=${encodeURIComponent(`/konts/pasutijumi/${id}`)}`);
  const found = await orderWithOffer(db, id);
  if (!found || found.order.userId !== userId) notFound();
  const { order, offer } = found;
  const t = await getTranslations("orders");
  const sp = await searchParams;
  const [events, invoices] = await Promise.all([eventsOf(db, offer.id), invoicesOf(db, order.id)]);
  const now = new Date();
  const promised = deliveryBy(order.paidAt ?? now, offer.deliveryWorkingDays);
  const carrier = carrierById(order.carrier)?.name ?? order.carrier ?? "";
  const status =
    order.status === "awaiting_payment"
      ? t("line.awaiting")
      : order.status === "paid" || order.status === "packed"
        ? t("line.preparing", { date: formatDateDative(promised) })
        : order.status === "shipped"
          ? t("line.shipped", { carrier })
          : order.status === "delivered"
            ? t("line.delivered", { date: formatDayLocative(order.deliveredAt!) })
            : t(`line.${order.status}`);
  const deadline = withdrawalDeadline(order.deliveredAt);
  const inbox = companyFromEnv().email;
  const months = guaranteeMonths(order.buyerKind, offer.warrantyMonths);

  return (
    <Page size="narrow" gap="gap-5">
      <div className="flex flex-col gap-2">
        <Kicker>{t("orderKicker", { number: order.number })}</Kicker>
        <PageTitle>{offer.productName}</PageTitle>
        <p className="font-heading text-2xl font-bold text-mist">{formatEur(order.amountCents)}</p>
      </div>
      {sp.apmaksats && order.status !== "awaiting_payment" ? (
        <InfoBox>
          <span role="status">{t("thanks")}</span>
        </InfoBox>
      ) : null}
      {order.status === "awaiting_payment" && (sp.gaida || !paymentsEnabled()) ? (
        <InfoBox>
          <span role="status">{t("paymentsSoon")}</span>
        </InfoBox>
      ) : null}

      <Panel tone="lime" className="flex flex-col gap-3">
        <p className="text-xl font-semibold text-mist" data-testid="order-status">
          {status}
        </p>
        {order.trackingUrl ? (
          <a
            href={order.trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass({ variant: "outline", size: "sm" })}
          >
            {t("track", { carrier, number: order.trackingNumber ?? "" })}
          </a>
        ) : null}
        {order.status === "shipped" ? (
          <form action={confirmDeliveryAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <Button type="submit" variant="outline" size="sm">
              {t("received")}
            </Button>
          </form>
        ) : null}
        {order.status === "awaiting_payment" && paymentsEnabled() ? (
          <ButtonLink href={`/piedavajums/${offer.token}/pasutit`}>
            {t("pay", { amount: formatEur(order.amountCents) })}
          </ButtonLink>
        ) : null}
      </Panel>

      <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px] text-mist">
        <dt className="text-stone">{t("deliveryTo")}</dt>
        <dd>
          {order.deliveryMethod === "locker"
            ? order.lockerName
            : [order.fullName, order.street, order.city, order.postcode].filter(Boolean).join(", ")}
        </dd>
        <dt className="text-stone">{t("deliveryPrice")}</dt>
        <dd>{t("free")}</dd>
        <dt className="text-stone">{t("warranty")}</dt>
        <dd>{t("warrantyText", { months, email: inbox })}</dd>
        {order.buyerKind === "person" && order.paidAt ? (
          <>
            <dt className="text-stone">{t("withdrawal")}</dt>
            <dd>
              {deadline ? t("withdrawalUntil", { date: formatDateDative(deadline) }) : t("withdrawalBefore")}
            </dd>
          </>
        ) : null}
      </dl>

      {invoices.length ? (
        <div className="flex flex-wrap gap-2">
          {invoices.map((inv) => (
            <Link
              key={inv.id}
              href={`/rekins/${inv.id}`}
              className={buttonClass({ variant: "outline", size: "sm" })}
            >
              {inv.kind === "invoice"
                ? t("invoice", { number: inv.number })
                : t("creditNote", { number: inv.number })}
            </Link>
          ))}
        </div>
      ) : null}

      {canWithdraw(order, now) ? (
        <Panel className="flex flex-col gap-3">
          <h2 className="font-heading text-xl font-semibold text-mist">{t("withdrawTitle")}</h2>
          <p className="text-[15px] text-stone">{t("withdrawBody")}</p>
          <form action={withdrawAction}>
            <input type="hidden" name="orderId" value={order.id} />
            <Button type="submit" variant="outline" size="sm">
              {t("withdraw")}
            </Button>
          </form>
        </Panel>
      ) : null}

      <section aria-labelledby="timeline-title" className="flex flex-col gap-3">
        <h2 id="timeline-title" className="font-heading text-xl font-semibold text-mist">
          {t("timeline")}
        </h2>
        <Timeline events={events} audience="buyer" />
      </section>
    </Page>
  );
}
