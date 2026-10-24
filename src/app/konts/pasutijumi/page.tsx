import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentUserId } from "@/auth";
import { db } from "@/db";
import { formatDateShort, formatEur } from "@/i18n/format";
import { ordersOfUser } from "@/services/offers/orders";
import { Kicker, Page, PageTitle, Panel } from "@/ui/layout";

// "Mani pasūtījumi": orders bought from Trilio itself.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mani pasūtījumi", robots: { index: false, follow: false } };

export default async function MyOrders() {
  const userId = await currentUserId();
  if (!userId) redirect("/ienakt?callbackUrl=/konts/pasutijumi");
  const t = await getTranslations("orders");
  const rows = await ordersOfUser(db, userId);
  return (
    <Page size="text">
      <div className="flex flex-col gap-2">
        <Kicker>{t("kicker")}</Kicker>
        <PageTitle scale="results">{t("title")}</PageTitle>
      </div>
      {rows.length === 0 ? (
        <Panel tone="dashed">
          <p className="text-lg text-mist">{t("empty")}</p>
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ order, offer }) => (
            <li key={order.id}>
              <Link
                href={`/konts/pasutijumi/${order.id}`}
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-card border-[1.5px] border-line-40 px-5 py-4 text-mist hover:border-lime"
              >
                <span className="flex flex-col">
                  <span className="text-lg font-bold">{offer.productName}</span>
                  <span className="text-sm text-stone">
                    {order.number} · {formatDateShort(order.createdAt)}
                  </span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="font-heading text-xl font-bold">{formatEur(order.amountCents)}</span>
                  <span className="text-sm text-lime">{t(`status.${order.status}`)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
