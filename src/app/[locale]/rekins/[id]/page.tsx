import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminEmail } from "@/config/admin";
import { db, invoices, offerOrders } from "@/db";
import { InvoiceDocument } from "@/ui/InvoiceDocument";
import { localPath } from "@/i18n/path";

// An invoice, for its buyer and for the admin; nobody else.

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
    .select({ invoice: invoices, order: offerOrders })
    .from(invoices)
    .innerJoin(offerOrders, eq(offerOrders.id, invoices.orderId))
    .where(eq(invoices.id, id));
  if (!row) notFound();
  if (row.order.userId !== session.user.id && !isAdminEmail(session.user.email)) notFound();
  return (
    <div className="pt-3 pb-12">
      <InvoiceDocument invoice={row.invoice} orderNumber={row.order.number} />
    </div>
  );
}
