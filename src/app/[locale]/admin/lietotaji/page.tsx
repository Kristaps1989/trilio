import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { formatDateShort, formatInt } from "@/i18n/format";
import { listUsers } from "@/services/admin/stats";
import { Button } from "@/ui/Button";
import { requireAdmin } from "../guard";
import { AdminTitle, Chip, inputClass, Table } from "../ui";

// Lietotāji: who uses Trilio, what they saved, who may receive offers.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lietotāji" };

type Props = { searchParams: Promise<{ q?: string }> };

export default async function AdminUsers({ searchParams }: Props) {
  await requireAdmin("/admin/lietotaji");
  const t = await getTranslations("admin.users");
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const rows = await listUsers(db, q);
  return (
    <>
      <AdminTitle title={t("title")} sub={t("count", { count: rows.length })} />
      <form role="search" className="flex max-w-xl gap-2" action="/admin/lietotaji">
        <label htmlFor="user-q" className="sr-only">
          {t("search")}
        </label>
        <input
          id="user-q"
          name="q"
          defaultValue={q}
          placeholder={t("searchPlaceholder")}
          className={inputClass}
        />
        <Button type="submit" variant="outline" size="sm">
          {t("search")}
        </Button>
      </form>
      <Table
        caption={t("title")}
        head={[t("email"), t("since"), t("saved"), t("service"), t("offers")]}
        empty={t("empty")}
        rows={rows.map((u) => [
          <Link
            key="e"
            href={`/admin/lietotaji/${u.id}`}
            className="font-semibold underline underline-offset-2"
          >
            {u.email}
            {u.name ? <span className="block text-sm font-normal text-stone">{u.name}</span> : null}
          </Link>,
          formatDateShort(u.createdAt),
          t("savedCount", { products: u.savedProducts, searches: u.savedSearches }),
          u.subscribed ? <Chip tone="lime">{t("subscribed")}</Chip> : "—",
          <span key="o" className="flex flex-wrap items-center gap-1.5">
            {u.offersOptIn ? <Chip tone="lime">{t("optIn")}</Chip> : <Chip>{t("noOptIn")}</Chip>}
            {u.offersSent ? (
              <span className="text-sm text-stone">
                {t("sentPaid", { sent: formatInt(u.offersSent), paid: formatInt(u.ordersPaid) })}
              </span>
            ) : null}
          </span>,
        ])}
      />
    </>
  );
}
