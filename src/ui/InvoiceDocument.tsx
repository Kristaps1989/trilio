import { getTranslations } from "next-intl/server";
import type { Invoice } from "@/db/schema";
import { formatDateShort, formatEur } from "@/i18n/format";
import { PrintButton } from "./PrintButton";
import { DELIVERY_LINE } from "@/services/offers/orders";

// An invoice or credit note from Trilio's series, printable (docs/ADMIN_AND_OFFERS_PLAN.md
// §2.4, §9). Seller and buyer come from the invoice's own snapshot.

export async function InvoiceDocument({ invoice, orderNumber }: { invoice: Invoice; orderNumber: string }) {
  const t = await getTranslations("invoice");
  const s = invoice.seller;
  const b = invoice.buyer;
  const company = b.kind === "company";
  return (
    <article className="mx-auto flex w-full max-w-[760px] flex-col gap-5 rounded-panel-lg bg-white p-6 text-night print:max-w-none print:rounded-none print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">
            {invoice.kind === "invoice" ? t("title") : t("creditTitle")} {invoice.number}
          </h1>
          <p className="text-sm text-muted">
            {t("date", { date: formatDateShort(invoice.issuedAt) })} · {t("order", { number: orderNumber })}
          </p>
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
      <p className="text-sm text-muted">{invoice.kind === "invoice" ? t("paid") : t("refunded")}</p>
    </article>
  );
}
