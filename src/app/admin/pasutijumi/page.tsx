import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { isLate } from "@/domain/offers/offers";
import { formatDateShort, formatEur } from "@/i18n/format";
import { listOrders } from "@/services/admin/stats";
import { buttonClass } from "@/ui/Button";
import { requireAdmin } from "../guard";
import { AdminTitle, Chip, FilterLinks, Table } from "../ui";

// Pasūtījumi: paid orders with delivery state; late parcels stand out.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pasūtījumi" };

const STATUSES = [
  "all",
  "awaiting_payment",
  "paid",
  "packed",
  "shipped",
  "delivered",
  "return_requested",
  "returned",
  "refunded",
  "cancelled",
] as const;

type Props = { searchParams: Promise<{ status?: string }> };

export default async function AdminOrders({ searchParams }: Props) {
  await requireAdmin("/admin/pasutijumi");
  const t = await getTranslations("admin.orders");
  const ts = await getTranslations("admin.status");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? sp.status! : "all";
  const rows = await listOrders(db, status === "all" ? undefined : status);
  const now = new Date();
  return (
    <>
      <AdminTitle title={t("title")}>
        <a href="/admin/pasutijumi/csv" download className={buttonClass({ variant: "outline", size: "sm" })}>
          {t("csv")}
        </a>
      </AdminTitle>
      <FilterLinks
        label={t("filter")}
        items={STATUSES.map((s) => ({
          href: s === "all" ? "/admin/pasutijumi" : `/admin/pasutijumi?status=${s}`,
          label: s === "all" ? t("all") : ts(`order.${s}`),
          active: s === status,
        }))}
      />
      <Table
        caption={t("title")}
        head={[t("number"), t("product"), t("buyer"), t("amount"), t("status"), t("date")]}
        empty={t("empty")}
        rows={rows.map(({ order, offer }) => {
          const late = isLate(order, now);
          return [
            <Link
              key="n"
              href={`/admin/pasutijumi/${order.id}`}
              className="font-semibold underline underline-offset-2"
            >
              {order.number}
            </Link>,
            offer.productName,
            <span key="b">
              {order.buyerKind === "company" ? (order.companyName ?? order.fullName) : order.fullName}
              <span className="block text-sm text-stone">
                {order.deliveryMethod === "locker" ? order.lockerName : order.city}
              </span>
            </span>,
            formatEur(order.amountCents),
            <span key="s" className="flex flex-wrap gap-1">
              <Chip tone={late ? "warning" : order.status === "delivered" ? "lime" : "neutral"}>
                {ts(`order.${order.status}`)}
              </Chip>
              {late ? <Chip tone="warning">{t("late")}</Chip> : null}
            </span>,
            formatDateShort(order.paidAt ?? order.createdAt),
          ];
        })}
      />
    </>
  );
}
