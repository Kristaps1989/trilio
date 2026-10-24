import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { CARRIERS, isLate, nextSteps, withdrawalDeadline } from "@/domain/offers/offers";
import { formatDateShort, formatEur } from "@/i18n/format";
import { eventsOf } from "@/services/offers/offers";
import { invoicesOf, orderWithOffer } from "@/services/offers/orders";
import { Button, buttonClass } from "@/ui/Button";
import { Timeline } from "@/ui/Timeline";
import { correctDeliveryAction, orderNoteAction, orderStepAction, resolveProblemAction } from "../../actions";
import { requireAdmin } from "../../guard";
import { AdminTitle, Chip, Section, inputClass, labelClass } from "../../ui";

// One order (docs/ADMIN_AND_OFFERS_PLAN.md §10): who, where, the timeline and
// the next steps as big buttons at the bottom, phone-first.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pasūtījums" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> };

function StepButton({
  orderId,
  to,
  label,
  variant = "primary",
}: {
  orderId: string;
  to: string;
  label: string;
  variant?: "primary" | "outline";
}) {
  return (
    <form action={orderStepAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="to" value={to} />
      <Button type="submit" size="lg" variant={variant} block>
        {label}
      </Button>
    </form>
  );
}

export default async function AdminOrder({ params, searchParams }: Props) {
  const { id } = await params;
  await requireAdmin(`/admin/pasutijumi/${id}`);
  const t = await getTranslations("admin.order");
  const ts = await getTranslations("admin.status");
  const found = await orderWithOffer(db, id);
  if (!found) notFound();
  const { order, offer } = found;
  const sp = await searchParams;
  const [events, invoices] = await Promise.all([eventsOf(db, offer.id), invoicesOf(db, order.id)]);
  const steps = nextSteps(order.status);
  const late = isLate(order, new Date());
  const resolved = events.some((e) => e.kind === "problem_resolved");
  const deadline = withdrawalDeadline(order.deliveredAt);
  const address =
    order.deliveryMethod === "locker"
      ? t("locker", { name: order.lockerName ?? order.lockerId ?? "" })
      : [order.street, order.city, order.postcode].filter(Boolean).join(", ");

  return (
    <>
      <AdminTitle title={`${order.number} · ${offer.productName}`} sub={formatEur(order.amountCents)}>
        <div className="flex flex-wrap gap-2">
          <Chip tone={late ? "warning" : "neutral"}>{ts(`order.${order.status}`)}</Chip>
          {late ? <Chip tone="warning">{t("late")}</Chip> : null}
          <Chip>{order.buyerKind === "company" ? t("company") : t("person")}</Chip>
        </div>
      </AdminTitle>
      {sp.error ? (
        <p role="alert" className="rounded-[14px] bg-over-bg px-4 py-3 text-over-text">
          {t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : sp.error}
        </p>
      ) : null}
      {sp.done ? (
        <p role="status" className="rounded-[14px] bg-lime-12 px-4 py-3 text-mist">
          {t("done", { status: ts(`order.${sp.done}`) })}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="flex flex-col gap-5">
          <Section title={t("buyer")} id="buyer">
            <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px] text-mist">
              <dt className="text-stone">{t("name")}</dt>
              <dd>{order.fullName}</dd>
              {order.buyerKind === "company" ? (
                <>
                  <dt className="text-stone">{t("companyName")}</dt>
                  <dd>
                    {order.companyName} · {order.companyRegNo}
                    {order.companyVatNo ? ` · ${order.companyVatNo}` : ""}
                  </dd>
                  {order.legalAddress ? (
                    <>
                      <dt className="text-stone">{t("legalAddress")}</dt>
                      <dd>{order.legalAddress}</dd>
                    </>
                  ) : null}
                </>
              ) : null}
              <dt className="text-stone">{t("phone")}</dt>
              <dd>
                {order.phone ? (
                  <a href={`tel:${order.phone.replace(/\s/g, "")}`} className="underline">
                    {order.phone}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-stone">{t("email")}</dt>
              <dd className="break-all">{order.email}</dd>
              <dt className="text-stone">{t("delivery")}</dt>
              <dd>
                {address}
                {order.carryIn ? <span className="block text-lime">{t("carryIn")}</span> : null}
                {order.deliveryNote ? <span className="block text-stone">{order.deliveryNote}</span> : null}
              </dd>
              {order.trackingUrl || order.trackingNumber ? (
                <>
                  <dt className="text-stone">{t("tracking")}</dt>
                  <dd>
                    {CARRIERS.find((c) => c.id === order.carrier)?.name ?? order.carrier}{" "}
                    {order.trackingUrl ? (
                      <a
                        href={order.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {order.trackingNumber ?? order.trackingUrl}
                      </a>
                    ) : (
                      order.trackingNumber
                    )}
                  </dd>
                </>
              ) : null}
              {deadline && order.buyerKind === "person" ? (
                <>
                  <dt className="text-stone">{t("withdrawal")}</dt>
                  <dd>{formatDateShort(deadline)}</dd>
                </>
              ) : null}
              {order.feedback ? (
                <>
                  <dt className="text-stone">{t("feedback")}</dt>
                  <dd className={order.feedback === "problem" ? "text-warning" : "text-lime"}>
                    {order.feedback === "ok" ? t("feedbackOk") : t("feedbackProblem")}
                    {order.feedbackNote ? (
                      <span className="block text-mist">{order.feedbackNote}</span>
                    ) : null}
                  </dd>
                </>
              ) : null}
            </dl>
          </Section>

          <div className="flex flex-wrap gap-2">
            {invoices.map((inv) => (
              <a
                key={inv.id}
                href={`/rekins/${inv.id}`}
                className={buttonClass({ variant: "outline", size: "sm" })}
              >
                {inv.kind === "invoice"
                  ? t("invoice", { number: inv.number })
                  : t("creditNote", { number: inv.number })}
              </a>
            ))}
            {order.paidAt ? (
              <Link
                href={`/admin/pasutijumi/${order.id}/pavadzime`}
                className={buttonClass({ variant: "outline", size: "sm" })}
              >
                {t("packingSlip")}
              </Link>
            ) : null}
            <Link
              href={`/admin/piedavajumi/${offer.id}`}
              className={buttonClass({ variant: "outline", size: "sm" })}
            >
              {t("offer")}
            </Link>
          </div>

          <Section title={t("timeline")} id="timeline">
            <Timeline events={events} />
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="font-heading text-xl font-semibold text-mist">{t("next")}</h2>
          {steps.length === 0 ? <p className="text-[15px] text-stone">{t("closed")}</p> : null}
          {steps.includes("packed") ? (
            <StepButton orderId={order.id} to="packed" label={t("step.packed")} variant="outline" />
          ) : null}
          {steps.includes("shipped") ? (
            <form
              action={orderStepAction}
              className="flex flex-col gap-3 rounded-panel-lg border-[1.5px] border-line-25 p-4"
            >
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="to" value="shipped" />
              <fieldset className="flex flex-wrap gap-2">
                <legend className="mb-1 text-[15px] font-semibold text-mist">{t("carrier")}</legend>
                {CARRIERS.map((c, i) => (
                  <label
                    key={c.id}
                    className="inline-flex min-h-11 cursor-pointer items-center rounded-full border-[1.5px] border-line-30 px-4 text-[15px] font-semibold text-mist has-[:checked]:border-mist has-[:checked]:bg-mist has-[:checked]:text-night"
                  >
                    <input
                      type="radio"
                      name="carrier"
                      value={c.id}
                      defaultChecked={i === 0}
                      className="sr-only"
                    />
                    {c.name}
                  </label>
                ))}
              </fieldset>
              <label className={labelClass}>
                {t("trackingNumber")}
                <input
                  name="trackingNumber"
                  inputMode="text"
                  autoCapitalize="characters"
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {t("trackingUrl")}
                <input name="trackingUrl" type="url" inputMode="url" className={inputClass} />
              </label>
              <Button type="submit" size="lg" block>
                {t("step.shipped")}
              </Button>
            </form>
          ) : null}
          {steps.includes("delivered") ? (
            <StepButton orderId={order.id} to="delivered" label={t("step.delivered")} />
          ) : null}
          {steps.includes("returned") ? (
            <StepButton orderId={order.id} to="returned" label={t("step.returned")} />
          ) : null}
          {steps.includes("refunded") ? (
            <form
              action={orderStepAction}
              className="flex flex-col gap-3 rounded-panel-lg border-[1.5px] border-line-25 p-4"
            >
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="to" value="refunded" />
              <label className={labelClass}>
                {t("refundReference")}
                <input name="refundReference" required className={inputClass} />
              </label>
              <Button type="submit" variant="outline" block>
                {t("step.refunded")}
              </Button>
            </form>
          ) : null}
          {steps.includes("return_requested") ? (
            <StepButton
              orderId={order.id}
              to="return_requested"
              label={t("step.return_requested")}
              variant="outline"
            />
          ) : null}
          {steps.includes("cancelled") ? (
            <StepButton orderId={order.id} to="cancelled" label={t("step.cancelled")} variant="outline" />
          ) : null}

          {order.deliveredAt ? (
            <form action={correctDeliveryAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="orderId" value={order.id} />
              <label className={labelClass}>
                {t("correctDelivery", { date: formatDateShort(order.deliveredAt) })}
                <input type="date" name="deliveredAt" required className={inputClass} />
              </label>
              <Button type="submit" variant="outline" size="sm">
                {t("correct")}
              </Button>
            </form>
          ) : null}

          {order.feedback === "problem" && !resolved ? (
            <form action={resolveProblemAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <Button type="submit" variant="outline" block>
                {t("resolve")}
              </Button>
            </form>
          ) : null}

          <form action={orderNoteAction} className="flex flex-col gap-2">
            <input type="hidden" name="orderId" value={order.id} />
            <label className={labelClass}>
              {t("note")}
              <textarea name="note" rows={2} required className={`${inputClass} py-2`} />
            </label>
            <div>
              <Button type="submit" variant="outline" size="sm">
                {t("addNote")}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
