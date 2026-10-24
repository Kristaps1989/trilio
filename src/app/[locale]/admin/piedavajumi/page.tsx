import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { margin, vatRateFor } from "@/domain/offers/offers";
import { companyFromEnv } from "@/config/company";
import { formatDateShort, formatEur } from "@/i18n/format";
import { listOffers } from "@/services/admin/stats";
import { ButtonLink } from "@/ui/Button";
import { requireAdmin } from "../guard";
import { AdminTitle, Chip, FilterLinks, Table } from "../ui";

// Piedāvājumi: every offer with its status, the saving it claims and the margin.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Piedāvājumi" };

const STATUSES = ["all", "draft", "sent", "opened", "accepted", "paid", "expired", "cancelled"] as const;

type Props = {
  searchParams: Promise<{ status?: string; created?: string; skipped?: string; failed?: string }>;
};

export default async function AdminOffers({ searchParams }: Props) {
  await requireAdmin("/admin/piedavajumi");
  const t = await getTranslations("admin.offers");
  const ts = await getTranslations("admin.status");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? sp.status! : "all";
  const rows = await listOffers(db, status === "all" ? undefined : status);
  const vatRate = vatRateFor(companyFromEnv().vatNo);
  return (
    <>
      <AdminTitle title={t("title")}>
        <ButtonLink href="/admin/piedavajumi/jauns">{t("new")}</ButtonLink>
      </AdminTitle>
      {sp.created ? (
        <p role="status" className="rounded-[14px] bg-lime-12 px-4 py-3 text-mist">
          {t("created", { count: Number(sp.created) || 0 })}
          {Number(sp.skipped) ? ` ${t("skipped", { count: Number(sp.skipped) })}` : ""}
          {Number(sp.failed) ? ` ${t("failed", { count: Number(sp.failed) })}` : ""}
        </p>
      ) : null}
      <FilterLinks
        label={t("filter")}
        items={STATUSES.map((s) => ({
          href: s === "all" ? "/admin/piedavajumi" : `/admin/piedavajumi?status=${s}`,
          label: s === "all" ? t("all") : ts(`offer.${s}`),
          active: s === status,
        }))}
      />
      <Table
        caption={t("title")}
        head={[t("product"), t("to"), t("price"), t("margin"), t("status"), t("validUntil")]}
        empty={t("empty")}
        rows={rows.map(({ offer, email, order }) => {
          const m = margin(offer.priceCents, offer.costCents, vatRate);
          return [
            <Link
              key="p"
              href={`/admin/piedavajumi/${offer.id}`}
              className="font-semibold underline underline-offset-2"
            >
              {offer.productName}
            </Link>,
            email ?? "—",
            formatEur(offer.priceCents),
            m ? formatEur(m.cents) : "—",
            <span key="s" className="flex flex-wrap gap-1">
              <Chip tone={offer.status === "paid" ? "lime" : "neutral"}>{ts(`offer.${offer.status}`)}</Chip>
              {order ? <Chip>{order.number}</Chip> : null}
            </span>,
            formatDateShort(offer.validUntil),
          ];
        })}
      />
    </>
  );
}
