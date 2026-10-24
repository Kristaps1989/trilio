import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { formatDateShort, formatEur } from "@/i18n/format";
import { userDetail } from "@/services/admin/stats";
import { Button, ButtonLink } from "@/ui/Button";
import { userNoteAction } from "../../actions";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, Section, Table, inputClass, labelClass } from "../../ui";

// One customer: saved products with today's best shop price, saved searches,
// offers and orders, and the admin's private notes.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lietotājs" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> };

export default async function AdminUser({ params, searchParams }: Props) {
  const { id } = await params;
  await requireAdmin(`/admin/lietotaji/${id}`);
  const t = await getTranslations("admin.user");
  const ts = await getTranslations("admin.status");
  const detail = await userDetail(db, id);
  if (!detail) notFound();
  const { user } = detail;
  const { saved } = await searchParams;

  return (
    <>
      <AdminTitle title={user.email} sub={t("since", { date: formatDateShort(user.createdAt) })}>
        <div className="flex flex-wrap gap-2">
          {user.offersOptIn ? <Chip tone="lime">{t("optIn")}</Chip> : <Chip>{t("noOptIn")}</Chip>}
          {detail.subscription ? <Chip>{t("service", { status: detail.subscription.status })}</Chip> : null}
        </div>
      </AdminTitle>
      {!user.offersOptIn ? <p className="text-[15px] text-stone">{t("noOptInHint")}</p> : null}

      <Section title={t("products")} id="products">
        <Table
          caption={t("products")}
          head={[t("product"), t("savedAt"), t("now"), ""]}
          empty={t("noProducts")}
          rows={detail.savedProducts.map(({ item, product, best }) => {
            const diff = best && item.baselinePriceCents ? best.priceCents - item.baselinePriceCents : null;
            return [
              <span key="n" className="font-semibold">
                {product.name}
              </span>,
              <span key="s">
                {formatDateShort(item.createdAt)}
                {item.baselinePriceCents ? (
                  <span className="block text-sm text-stone">{formatEur(item.baselinePriceCents)}</span>
                ) : null}
              </span>,
              best ? (
                <span key="b">
                  {formatEur(best.priceCents)} <span className="text-sm text-stone">{best.storeName}</span>
                  {diff ? (
                    <span className={`block text-sm ${diff < 0 ? "text-lime" : "text-warning"}`}>
                      {diff < 0 ? "−" : "+"}
                      {formatEur(Math.abs(diff))}
                    </span>
                  ) : null}
                </span>
              ) : (
                t("noOffer")
              ),
              user.offersOptIn ? (
                <ButtonLink
                  key="o"
                  href={`/admin/piedavajumi/jauns?product=${product.id}&user=${user.id}`}
                  size="sm"
                >
                  {t("makeOffer")}
                </ButtonLink>
              ) : null,
            ];
          })}
        />
      </Section>

      <Section title={t("searches")} id="searches">
        <Table
          caption={t("searches")}
          head={[t("search"), t("savedAt")]}
          empty={t("noSearches")}
          rows={detail.savedSearches.map((s) => [
            <Link
              key="l"
              href={`/rezultati?sub=${s.subcategoryId}&a=${s.answersParam ?? ""}`}
              className="underline underline-offset-2"
            >
              {s.label ?? s.subcategoryId}
            </Link>,
            formatDateShort(s.createdAt),
          ])}
        />
      </Section>

      <Section title={t("offers")} id="offers">
        <Table
          caption={t("offers")}
          head={[t("product"), t("price"), t("status"), t("order")]}
          empty={t("noOffers")}
          rows={detail.offers.map(({ offer, order }) => [
            <Link key="p" href={`/admin/piedavajumi/${offer.id}`} className="underline underline-offset-2">
              {offer.productName}
            </Link>,
            formatEur(offer.priceCents),
            ts(`offer.${offer.status}`),
            order ? (
              <Link key="o" href={`/admin/pasutijumi/${order.id}`} className="underline underline-offset-2">
                {order.number} · {ts(`order.${order.status}`)}
              </Link>
            ) : (
              "—"
            ),
          ])}
        />
      </Section>

      <Section title={t("notes")} id="notes">
        <form action={userNoteAction} className="flex max-w-2xl flex-col gap-3">
          <input type="hidden" name="userId" value={user.id} />
          <label className={labelClass}>
            {t("notesLabel")}
            <textarea
              name="note"
              rows={4}
              defaultValue={user.adminNote ?? ""}
              className={`${inputClass} py-2`}
            />
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm">
              {t("saveNotes")}
            </Button>
            {saved ? (
              <span role="status" className="text-sm text-lime">
                {t("notesSaved")}
              </span>
            ) : null}
          </div>
        </form>
      </Section>
    </>
  );
}
