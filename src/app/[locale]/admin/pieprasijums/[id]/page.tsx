import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { formatDateShort, formatEur } from "@/i18n/format";
import { leadItems, leadRecord } from "@/services/admin/crm";
import { Button, ButtonLink } from "@/ui/Button";
import { leadNoteAction } from "../../crm-actions";
import { NextStepBox, RecordProduct } from "../../crm";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, Section, Table, inputClass, labelClass } from "../../ui";

// One lead (docs/CRM_PLAN.md §3.3): the product people asked to hear about,
// who saved it and whether they agreed to offers, every offer made for it,
// the partner mark with its history, and the owner's notes.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pieprasījums" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ partner?: string }>;
};

export default async function AdminLead({ params, searchParams }: Props) {
  const { id } = await params;
  await requireAdmin(`/admin/pieprasijums/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTranslations("admin.crm");
  const ts = await getTranslations("admin.status");
  const record = await leadRecord(db, id);
  if (!record) notFound();
  const item = (await leadItems(db)).find((i) => i.id === id);
  const optedIn = record.savers.filter((s) => s.optIn).length;
  const sp = await searchParams;

  return (
    <>
      <AdminTitle title={record.product.name} sub={t("leadSub", { count: record.savers.length })}>
        {optedIn > 0 ? (
          <ButtonLink href={`/admin/piedavajumi/jauns?product=${id}&all=1`}>
            {t("offerAll", { count: optedIn })}
          </ButtonLink>
        ) : null}
      </AdminTitle>
      <NextStepBox item={item} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-5">
          <RecordProduct productId={id} back={`/admin/pieprasijums/${id}`} status={sp.partner} />
          <Section title={t("leadNotes")} id="notes">
            {record.notes.length ? (
              <ol
                className="flex flex-col gap-2 border-l-2 border-line-25 pl-4 text-[15px] text-mist"
                data-lead-notes
              >
                {record.notes.map((n) => (
                  <li key={n.id}>
                    <span className="block">{n.note}</span>
                    <span className="text-sm text-stone">
                      {formatDateShort(n.createdAt)} · {n.createdBy}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[15px] text-stone">{t("noNotes")}</p>
            )}
            <form action={leadNoteAction} className="flex flex-col gap-2">
              <input type="hidden" name="productId" value={id} />
              <label className={labelClass}>
                {t("note")}
                <textarea name="note" rows={2} required maxLength={1000} className={`${inputClass} py-2`} />
              </label>
              <div>
                <Button type="submit" variant="outline" size="sm">
                  {t("addNote")}
                </Button>
              </div>
            </form>
          </Section>
        </div>
        <div className="flex flex-col gap-5">
          <Section title={t("leadSavers")} id="savers">
            <Table
              caption={t("leadSavers")}
              head={[t("email"), t("savedAt"), t("price"), ""]}
              rows={record.savers.map((s) => [
                <Link key="e" href={`/admin/lietotaji/${s.userId}`} className="underline underline-offset-2">
                  {s.email}
                </Link>,
                formatDateShort(s.savedAt),
                s.baselineCents !== null ? formatEur(s.baselineCents) : "—",
                s.optIn ? (
                  <Chip key="o" tone="lime">
                    {t("optIn")}
                  </Chip>
                ) : (
                  <Chip key="o">{t("noOptIn")}</Chip>
                ),
              ])}
            />
          </Section>
          <Section title={t("leadOffers")} id="offers">
            <Table
              caption={t("leadOffers")}
              head={[t("email"), t("price"), t("status"), t("created")]}
              empty={t("empty")}
              rows={record.offers.map(({ offer, email }) => [
                <Link
                  key="e"
                  href={`/admin/piedavajumi/${offer.id}`}
                  className="underline underline-offset-2"
                >
                  {email ?? "—"}
                </Link>,
                formatEur(offer.priceCents),
                <Chip key="s" tone={offer.status === "paid" ? "lime" : "neutral"}>
                  {ts(`offer.${offer.status}`)}
                </Chip>,
                formatDateShort(offer.createdAt),
              ])}
            />
          </Section>
        </div>
      </div>
    </>
  );
}
