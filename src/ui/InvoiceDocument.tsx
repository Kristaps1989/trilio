import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { Invoice } from "@/db/schema";
import { formatIban } from "@/domain/offers/offers";
import { formatDateShort, formatEur } from "@/i18n/format";
import { PrintButton } from "./PrintButton";
import type { GuaranteeSheet } from "@/services/offers/guarantee";
import { DELIVERY_LINE } from "@/services/offers/orders";

// A prepayment invoice, an invoice or a credit note, printable
// (docs/ADMIN_AND_OFFERS_PLAN.md §2.4, §9; docs/PAYMENTS.md). Seller and buyer come from
// the invoice's own snapshot. A prepayment invoice says how to pay it; a final invoice
// says when and how it was paid and carries the guarantee sheet on its own printed page.

const articleClass =
  "mx-auto flex w-full max-w-[760px] flex-col gap-5 rounded-panel-lg bg-white p-6 text-night print:max-w-none print:rounded-none print:p-0";

export async function InvoiceDocument({
  invoice,
  orderNumber,
  prepayment,
  guarantee,
}: {
  invoice: Invoice;
  orderNumber: string;
  /** For a prepayment invoice: where it stands, and the buyer's "Apmaksāt" button while it is open. */
  prepayment?: { state: "open" | "paid" | "expired"; pay?: ReactNode };
  /** For a final invoice: the guarantee sheet that goes with it. */
  guarantee?: GuaranteeSheet | null;
}) {
  const t = await getTranslations("invoice");
  const s = invoice.seller;
  const b = invoice.buyer;
  const company = b.kind === "company";
  const isPrepayment = invoice.kind === "prepayment";
  const title = isPrepayment
    ? t("prepaymentTitle")
    : invoice.kind === "invoice"
      ? t("title")
      : t("creditTitle");
  return (
    <>
      <article className={articleClass}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-bold">
              {title} {invoice.number}
            </h1>
            <p className="text-sm text-muted">
              {t("date", { date: formatDateShort(invoice.issuedAt) })} · {t("order", { number: orderNumber })}
            </p>
            {isPrepayment && invoice.dueAt ? (
              <p className="text-[15px] font-semibold">
                {t("due", { date: formatDateShort(invoice.dueAt) })}
              </p>
            ) : null}
            {!isPrepayment && invoice.basisNumber ? (
              <p className="text-sm text-muted">
                {t(invoice.kind === "invoice" ? "basis" : "creditBasis", { number: invoice.basisNumber })}
              </p>
            ) : null}
          </div>
          <PrintButton label={t("print")} />
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          <section aria-label={t("seller")} className="text-[15px]">
            <h2 className="text-sm font-bold text-muted uppercase">{t("seller")}</h2>
            <p className="font-semibold">{s.name || "Trilio"}</p>
            {s.regNo ? <p>{t("regNo", { value: s.regNo })}</p> : null}
            {s.vatNo ? <p>{t("vatNo", { value: s.vatNo })}</p> : null}
            {s.address ? <p>{s.address}</p> : null}
            {s.email ? <p>{s.email}</p> : null}
          </section>
          <section aria-label={t("buyer")} className="text-[15px]">
            <h2 className="text-sm font-bold text-muted uppercase">{t("buyer")}</h2>
            <p className="font-semibold">{b.name}</p>
            {company && b.regNo ? <p>{t("regNo", { value: b.regNo })}</p> : null}
            {company && b.vatNo ? <p>{t("vatNo", { value: b.vatNo })}</p> : null}
            {b.address ? <p>{b.address}</p> : null}
            {company && b.contact ? <p>{t("contact", { name: b.contact })}</p> : null}
          </section>
        </div>
        <table className="w-full border-collapse text-[15px]">
          <caption className="sr-only">{t("lines")}</caption>
          <thead>
            <tr className="border-b border-card-line text-left text-sm text-muted">
              <th scope="col" className="py-2">
                {t("item")}
              </th>
              <th scope="col" className="py-2 text-right">
                {t("qty")}
              </th>
              <th scope="col" className="py-2 text-right">
                {t("sum")}
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i} className="border-b border-card-line">
                <td className="py-2">{l.text === DELIVERY_LINE ? t("deliveryLine") : l.text}</td>
                <td className="py-2 text-right">{l.quantity}</td>
                <td className="py-2 text-right">{formatEur(l.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-[15px]">
          {invoice.vatRate ? (
            <>
              <dt>{t("net")}</dt>
              <dd className="text-right">{formatEur(invoice.netCents)}</dd>
              <dt>{t("vat", { rate: invoice.vatRate })}</dt>
              <dd className="text-right">{formatEur(invoice.vatCents)}</dd>
            </>
          ) : null}
          <dt className="font-bold">{t("total")}</dt>
          <dd className="text-right font-bold">{formatEur(invoice.totalCents)}</dd>
        </dl>
        {!invoice.vatRate ? <p className="text-sm">{t("noVat")}</p> : null}
        {isPrepayment ? (
          <section aria-labelledby="pay-title" className="flex flex-col gap-3 border-t border-card-line pt-4">
            <h2 id="pay-title" className="font-heading text-lg font-bold">
              {t("howToPay")}
            </h2>
            {prepayment?.state === "paid" ? <p className="text-[15px]">{t("prepaymentPaid")}</p> : null}
            {prepayment?.state === "expired" ? (
              <p className="text-[15px]">{t("prepaymentExpired", { email: s.email ?? "" })}</p>
            ) : null}
            {prepayment?.state === "open" && prepayment.pay ? (
              <div className="flex flex-col gap-2 print:hidden">
                <p className="text-[15px]">{t("payOnline")}</p>
                {prepayment.pay}
              </div>
            ) : null}
            {prepayment?.state !== "paid" && s.iban ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-[15px] font-semibold">{t("payTransfer")}</h3>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[15px] sm:grid-cols-[auto_1fr]">
                  <dt className="text-muted">{t("recipient")}</dt>
                  <dd>{s.name || "Trilio"}</dd>
                  <dt className="text-muted">{t("iban")}</dt>
                  <dd className="break-all font-semibold">{formatIban(s.iban)}</dd>
                  {s.bank ? (
                    <>
                      <dt className="text-muted">{t("bank")}</dt>
                      <dd>{s.bank}</dd>
                    </>
                  ) : null}
                  {s.swift ? (
                    <>
                      <dt className="text-muted">{t("swift")}</dt>
                      <dd>{s.swift}</dd>
                    </>
                  ) : null}
                  <dt className="text-muted">{t("amount")}</dt>
                  <dd className="font-semibold">{formatEur(invoice.totalCents)}</dd>
                  <dt className="text-muted">{t("purpose")}</dt>
                  <dd className="font-semibold">{t("purposeValue", { number: invoice.number })}</dd>
                </dl>
                <p className="text-sm text-muted">{t("transferNote")}</p>
              </div>
            ) : null}
            <p className="text-sm text-muted">{t("prepaymentNote")}</p>
          </section>
        ) : (
          <p className="text-sm text-muted">
            {invoice.kind === "credit_note"
              ? t("refunded")
              : invoice.paidAt
                ? t("paidOn", {
                    date: formatDateShort(invoice.paidAt),
                    method: t(invoice.paymentMethod === "transfer" ? "methodTransfer" : "methodOnline"),
                  })
                : t("paid")}
          </p>
        )}
        <p className="text-sm text-muted">{t("electronic")}</p>
      </article>
      {guarantee ? (
        <article
          aria-labelledby="guarantee-title"
          className={`${articleClass} mt-5 break-before-page print:mt-0`}
          data-testid="guarantee-sheet"
        >
          <h2 id="guarantee-title" className="font-heading text-2xl font-bold">
            {guarantee.title}
          </h2>
          {guarantee.sections.map((section, i) => (
            <section key={i} className="flex flex-col gap-2 text-[15px]">
              {section.heading ? <h3 className="font-heading text-lg font-bold">{section.heading}</h3> : null}
              {section.lines.map((line, j) => (
                <p key={j}>{line}</p>
              ))}
            </section>
          ))}
        </article>
      ) : null}
    </>
  );
}
