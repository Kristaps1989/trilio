import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { getSubcategory } from "@/domain/questions/catalog";
import { formatEur, formatInt } from "@/i18n/format";
import { demand } from "@/services/admin/stats";
import { ButtonLink } from "@/ui/Button";
import { requireAdmin } from "../guard";
import { AdminTitle, Table } from "../ui";

// Pieprasījums: the sourcing list. "12 people saved this washer, shops from
// 489 €, 30-day low 479 €" at a glance, and one tap to offer it to them.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pieprasījums" };

type Props = { searchParams: Promise<{ sub?: string; min?: string }> };

export default async function AdminDemand({ searchParams }: Props) {
  await requireAdmin("/admin/pieprasijums");
  const t = await getTranslations("admin.demand");
  const sp = await searchParams;
  const sub = sp.sub && getSubcategory(sp.sub) ? sp.sub : undefined;
  const min = Math.max(1, Math.min(100, Number(sp.min) || 1));
  const rows = await demand(db, { subcategoryId: sub, minSavers: min });
  return (
    <>
      <AdminTitle title={t("title")} sub={t("sub")} />
      <Table
        caption={t("title")}
        head={[t("product"), t("savers"), t("best"), t("low30"), ""]}
        empty={t("empty")}
        rows={rows.map((r) => [
          <span key="n">
            <span className="font-semibold">{r.name}</span>
            <span className="block text-sm text-stone">
              {getSubcategory(r.subcategoryId)?.label ?? r.subcategoryId}
            </span>
          </span>,
          <span key="s">
            {formatInt(r.savers)}
            <span className="block text-sm text-stone">{t("optedIn", { count: r.optedIn })}</span>
          </span>,
          r.bestCents !== null ? (
            <span key="b">
              {formatEur(r.bestCents)} <span className="block text-sm text-stone">{r.bestStore}</span>
            </span>
          ) : (
            t("noOffer")
          ),
          r.low30Cents !== null ? formatEur(r.low30Cents) : "—",
          r.optedIn > 0 ? (
            <ButtonLink key="o" href={`/admin/piedavajumi/jauns?product=${r.productId}&all=1`} size="sm">
              {t("offerAll", { count: r.optedIn })}
            </ButtonLink>
          ) : (
            <span key="x" className="text-sm text-stone">
              {t("nobodyOptedIn")}
            </span>
          ),
        ])}
      />
    </>
  );
}
