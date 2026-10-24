import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { offerSignature } from "@/config/admin";
import { companyFromEnv } from "@/config/company";
import { margin, savingClaim, vatRateFor } from "@/domain/offers/offers";
import { formatDateShort, formatEur } from "@/i18n/format";
import { eventsOf, offerById, previewOffer } from "@/services/offers/offers";
import { orderOfOffer } from "@/services/offers/orders";
import { appBaseUrl } from "@/services/payments";
import { Button } from "@/ui/Button";
import { cancelOfferAction, extendOfferAction, sendOfferAction } from "../../actions";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, Section, inputClass, labelClass } from "../../ui";
import { Timeline } from "@/ui/Timeline";

// One offer: the e-mail as sent (or as it would go), its link for sharing by
// hand, the timeline and the actions that fit its state.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Piedāvājums" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sent?: string; error?: string; created?: string }>;
};

export default async function AdminOffer({ params, searchParams }: Props) {
  const { id } = await params;
  await requireAdmin(`/admin/piedavajumi/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTranslations("admin.offer");
  const ts = await getTranslations("admin.status");
  const offer = await offerById(db, id);
  if (!offer) notFound();
  const sp = await searchParams;
  const base = appBaseUrl();
  const [events, order, preview] = await Promise.all([
    eventsOf(db, id),
    orderOfOffer(db, id),
    previewOffer(db, id, { baseUrl: base, signature: offerSignature() }),
  ]);
  const vatRate = vatRateFor(companyFromEnv().vatNo);
  const m = margin(offer.priceCents, offer.costCents, vatRate);
  const claim = savingClaim(offer.priceCents, {
    priceCents: offer.referencePriceCents,
    low30Cents: offer.referenceLow30Cents,
  });
  const link = `${base}/piedavajums/${offer.token}`;
  const open = ["sent", "opened", "accepted", "expired"].includes(offer.status);

  return (
    <>
      <AdminTitle
        title={offer.productName}
        sub={t("sub", { price: formatEur(offer.priceCents), date: formatDateShort(offer.validUntil) })}
      >
        <Chip tone={offer.status === "paid" ? "lime" : "neutral"}>{ts(`offer.${offer.status}`)}</Chip>
      </AdminTitle>
      {sp.sent || sp.created ? (
        <p role="status" className="rounded-[14px] bg-lime-12 px-4 py-3 text-mist">
          {offer.status === "draft" ? t("savedDraft") : t("sentDone")}
        </p>
      ) : null}
      {sp.error ? (
        <p role="alert" className="rounded-[14px] bg-over-bg px-4 py-3 text-over-text">
          {t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : sp.error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px] text-mist">
            <dt className="text-stone">{t("shops")}</dt>
            <dd>
              {offer.referencePriceCents !== null
                ? `${formatEur(offer.referencePriceCents)} (${offer.referenceStoreName ?? ""})`
                : "—"}
            </dd>
            <dt className="text-stone">{t("low30")}</dt>
            <dd>{offer.referenceLow30Cents !== null ? formatEur(offer.referenceLow30Cents) : "—"}</dd>
            <dt className="text-stone">{t("claim")}</dt>
            <dd>{claim ? t("claimYes", { saving: formatEur(claim.savingCents) }) : t("claimNo")}</dd>
            <dt className="text-stone">{t("margin")}</dt>
            <dd>{m ? `${formatEur(m.cents)} (${String(m.percent).replace(".", ",")} %)` : "—"}</dd>
            <dt className="text-stone">{t("supplier")}</dt>
            <dd>{offer.supplierNote ?? "—"}</dd>
            <dt className="text-stone">{t("condition")}</dt>
            <dd>
              {offer.condition === "refurbished" ? t("refurbished", { grade: offer.grade ?? "" }) : t("new")}{" "}
              · {t("warranty", { months: offer.warrantyMonths })}
            </dd>
          </dl>

          {offer.status !== "draft" ? (
            <label className={labelClass}>
              {t("link")}
              <input readOnly value={link} className={inputClass} />
            </label>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {offer.status === "draft" ? (
              <form action={sendOfferAction}>
                <input type="hidden" name="offerId" value={offer.id} />
                <Button type="submit" size="lg">
                  {t("send")}
                </Button>
              </form>
            ) : null}
            {["draft", "sent", "opened"].includes(offer.status) ? (
              <form action={cancelOfferAction}>
                <input type="hidden" name="offerId" value={offer.id} />
                <Button type="submit" variant="outline">
                  {t("cancel")}
                </Button>
              </form>
            ) : null}
            {order ? (
              <Link
                href={`/admin/pasutijumi/${order.id}`}
                className="inline-flex min-h-11 items-center text-mist underline underline-offset-2"
              >
                {t("order", { number: order.number })}
              </Link>
            ) : null}
          </div>

          {open || offer.status === "draft" ? (
            <form action={extendOfferAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="offerId" value={offer.id} />
              <label className={labelClass}>
                {t("extend")}
                <input type="date" name="validUntil" required className={inputClass} />
              </label>
              <Button type="submit" variant="outline" size="sm">
                {t("extendButton")}
              </Button>
            </form>
          ) : null}

          <Section title={t("timeline")} id="timeline">
            <Timeline events={events} />
          </Section>
        </div>

        <section aria-label={t("email")} className="flex flex-col gap-2">
          <h2 className="font-heading text-xl font-semibold text-mist">{t("email")}</h2>
          {preview ? (
            <div
              className="rounded-panel-lg bg-white p-5 text-night [overflow-wrap:anywhere]"
              data-testid="email-preview"
            >
              <p className="text-sm text-muted">{t("to", { email: preview.to })}</p>
              <p className="mt-1 font-bold">{preview.subject}</p>
              <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed whitespace-pre-line">
                {preview.text.split("\n\n").map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
