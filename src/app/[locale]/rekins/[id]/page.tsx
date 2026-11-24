import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminEmail } from "@/config/admin";
import { companyFromEnv } from "@/config/company";
import { db, invoices, offerOrders, specialOffers } from "@/db";
import { canAccept } from "@/domain/offers/offers";
import { formatEur } from "@/i18n/format";
import { isUiLocale } from "@/i18n/routing";
import { guaranteeSheet, sellerLine } from "@/services/offers/guarantee";
import { paymentsEnabled } from "@/services/payments";
import { Button } from "@/ui/Button";
import { InvoiceDocument } from "@/ui/InvoiceDocument";
import { localPath } from "@/i18n/path";
import { payOrderAction } from "../../konts/pasutijumi/actions";

// A prepayment invoice, an invoice or a credit note, for its buyer and for the admin; nobody
// else. The buyer pays an open prepayment invoice from here; a final invoice shows the
// guarantee sheet under it.

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoice");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = { params: Promise<{ id: string }> };

export default async function InvoicePage({ params }: Props) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id)
    redirect(await localPath(`/ienakt?callbackUrl=${encodeURIComponent(`/rekins/${id}`)}`));
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ invoice: invoices, order: offerOrders, offer: specialOffers })
    .from(invoices)
    .innerJoin(offerOrders, eq(offerOrders.id, invoices.orderId))
    .innerJoin(specialOffers, eq(specialOffers.id, offerOrders.offerId))
    .where(eq(invoices.id, id));
  if (!row) notFound();
  const own = row.order.userId === session.user.id;
  if (!own && !isAdminEmail(session.user.email)) notFound();
  const { invoice, order, offer } = row;
  const locale = await getLocale();
  const lang = isUiLocale(locale) ? locale : "lv";
  const t = await getTranslations("invoice");

  const open = order.status === "awaiting_payment" && canAccept(offer, new Date());
  const prepayment =
    invoice.kind === "prepayment"
      ? {
          state: order.paidAt ? ("paid" as const) : open ? ("open" as const) : ("expired" as const),
          pay:
            own && open && paymentsEnabled() ? (
              <form action={payOrderAction}>
                <input type="hidden" name="orderId" value={order.id} />
                <Button type="submit">
                  {t("payOnlineButton", { amount: formatEur(order.amountCents) })}
                </Button>
              </form>
            ) : undefined,
        }
      : undefined;
  const guarantee =
    invoice.kind === "invoice"
      ? guaranteeSheet(
          {
            buyerKind: order.buyerKind,
            warrantyMonths: offer.warrantyMonths,
            grade: offer.condition === "refurbished" ? (offer.grade ?? "") : null,
            product: offer.productName,
            orderNumber: order.number,
            invoiceNumber: invoice.number,
            seller: sellerLine(invoice.seller, lang),
            email: invoice.seller.email || companyFromEnv().email,
          },
          lang,
        )
      : null;
  return (
    <div className="pt-3 pb-12">
      <InvoiceDocument
        invoice={invoice}
        orderNumber={order.number}
        prepayment={prepayment}
        guarantee={guarantee}
      />
    </div>
  );
}
