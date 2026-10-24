import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { formatDateShort } from "@/i18n/format";
import { orderWithOffer } from "@/services/offers/orders";
import { PrintButton } from "@/ui/PrintButton";
import { requireAdmin } from "../../../guard";

// Packing slip: what goes in the box and where it goes, on one printed page.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pavadzīme" };

type Props = { params: Promise<{ id: string }> };

export default async function PackingSlip({ params }: Props) {
  const { id } = await params;
  await requireAdmin(`/admin/pasutijumi/${id}/pavadzime`);
  const t = await getTranslations("admin.slip");
  const found = await orderWithOffer(db, id);
  if (!found) notFound();
  const { order, offer } = found;
  return (
    <article className="mx-auto flex w-full max-w-[760px] flex-col gap-4 rounded-panel-lg bg-white p-6 text-night">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">{t("title", { number: order.number })}</h1>
          <p className="text-sm text-muted">{formatDateShort(order.paidAt ?? order.createdAt)}</p>
        </div>
        <PrintButton label={t("print")} />
      </header>
      <section className="text-lg">
        <h2 className="text-sm font-bold text-muted uppercase">{t("to")}</h2>
        <p className="font-semibold">
          {order.buyerKind === "company" ? `${order.companyName} · ${order.fullName}` : order.fullName}
        </p>
        <p>{order.phone}</p>
        {order.deliveryMethod === "locker" ? (
          <p>{t("locker", { name: order.lockerName ?? order.lockerId ?? "" })}</p>
        ) : (
          <p>{[order.street, order.city, order.postcode].filter(Boolean).join(", ")}</p>
        )}
        {order.carryIn ? <p className="font-bold">{t("carryIn")}</p> : null}
        {order.deliveryNote ? <p>{order.deliveryNote}</p> : null}
      </section>
      <section className="text-lg">
        <h2 className="text-sm font-bold text-muted uppercase">{t("contents")}</h2>
        <p>
          1 × {offer.productName}
          {offer.condition === "refurbished" ? ` (${t("refurbished", { grade: offer.grade ?? "" })})` : ""}
        </p>
      </section>
      <p className="text-sm text-muted">{t("thanks")}</p>
    </article>
  );
}
