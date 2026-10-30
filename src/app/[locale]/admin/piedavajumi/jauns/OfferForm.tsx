"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useActionState, useState, useTransition } from "react";
import { margin, savingClaim, vatSplit } from "@/domain/offers/offers";
import { formatEur } from "@/i18n/format";
import { composeOfferEmail } from "@/services/offers/compose";
import { Button } from "@/ui/Button";
import { createOfferAction, type OfferFormState } from "../../actions";
import { EmailPreview } from "../EmailPreview";
import { inputClass, labelClass } from "../../ui";

// The offer form (docs/ADMIN_AND_OFFERS_PLAN.md §11.10): everything prefilled
// but the price. Typing the price updates the saving the e-mail may claim,
// the margin and the e-mail itself, composed by the same code the sender uses.

export type Recipient = {
  id: string;
  email: string;
  optIn: boolean;
  saved: { at: string; priceCents: number | null } | null;
};

type Props = {
  product: { id: string; name: string; imageUrl: string | null };
  reference: { priceCents: number | null; storeName: string | null; low30Cents: number | null };
  recipients: Recipient[];
  vatRate: number | null;
  signature: string;
  inbox: string;
  company: string;
  baseUrl: string;
  defaults: { validUntil: string; deliveryWorkingDays: number; warrantyMonths: number };
};

function cents(raw: string): number | null {
  const v = raw.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

export function OfferForm({
  product,
  reference,
  recipients,
  vatRate,
  signature,
  inbox,
  company,
  baseUrl,
  defaults,
}: Props) {
  const t = useTranslations("admin.offerForm");
  const [state, action, pending] = useActionState<OfferFormState, FormData>(createOfferAction, {
    error: null,
  });
  // With JavaScript the action is dispatched here, so React does not reset the form
  // after a failed submit (the admin keeps what was typed); without it the plain
  // form action still works.
  const [, startSubmit] = useTransition();
  const keepForm = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startSubmit(() => action(data));
  };
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [condition, setCondition] = useState<"new" | "refurbished">("new");
  const [grade, setGrade] = useState("");
  const [warranty, setWarranty] = useState(String(defaults.warrantyMonths));
  const [days, setDays] = useState(String(defaults.deliveryWorkingDays));
  const [validUntil, setValidUntil] = useState(defaults.validUntil);
  const [message, setMessage] = useState("");
  const allowed = recipients.filter((r) => r.optIn);
  const [chosen, setChosen] = useState<Set<string>>(new Set(allowed.map((r) => r.id)));

  const priceCents = cents(price);
  const costCents = cents(cost);
  const claim = priceCents
    ? savingClaim(priceCents, { priceCents: reference.priceCents, low30Cents: reference.low30Cents })
    : null;
  const gain = priceCents ? margin(priceCents, costCents, vatRate) : null;
  const split = priceCents ? vatSplit(priceCents, vatRate) : null;
  const first = recipients.find((r) => chosen.has(r.id));

  // The React Compiler memoises this; the e-mail is recomposed only when an input changes.
  const preview = (() => {
    if (!priceCents || !first) return null;
    return composeOfferEmail(
      {
        token: null,
        productName: product.name,
        priceCents,
        deliveryWorkingDays: Number(days) || 1,
        referencePriceCents: reference.priceCents,
        referenceLow30Cents: reference.low30Cents,
        condition,
        grade: grade || null,
        warrantyMonths: Number(warranty) || 0,
        message: message.trim() || null,
        validUntil: new Date(`${validUntil}T20:59:59Z`),
        imageUrl: product.imageUrl,
      },
      {
        baseUrl,
        signature,
        inbox,
        company,
        to: first.email,
        unsubscribeUrl: `${baseUrl}/piedavajumi/atteikties/…`,
        saved: first.saved ? { at: new Date(first.saved.at), priceCents: first.saved.priceCents } : null,
        now: new Date(),
      },
    );
  })();

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={action} onSubmit={keepForm} className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <input type="hidden" name="productId" value={product.id} />
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[15px] font-semibold text-mist">
            {t("recipients", { count: chosen.size })}
          </legend>
          <ul className="flex flex-col gap-1.5">
            {recipients.map((r) => (
              <li key={r.id}>
                <label
                  className={`flex min-h-11 items-center gap-3 text-[15px] ${r.optIn ? "text-mist" : "text-stone"}`}
                >
                  <input
                    type="checkbox"
                    name="userIds"
                    value={r.id}
                    checked={chosen.has(r.id)}
                    disabled={!r.optIn}
                    onChange={() => toggle(r.id)}
                    className="h-5 w-5 accent-lime"
                  />
                  <span>
                    {r.email}
                    {!r.optIn ? <span className="block text-sm">{t("noConsent")}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <label className={labelClass}>
          {t("price")}
          <input
            name="price"
            inputMode="decimal"
            required
            autoFocus
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={reference.priceCents ? (reference.priceCents / 100).toFixed(0) : "0"}
            className={`${inputClass} font-heading text-2xl`}
          />
        </label>

        <div
          className="rounded-panel-lg border-[1.5px] border-line-25 p-4 text-[15px] text-mist"
          aria-live="polite"
        >
          <p>
            {reference.priceCents !== null
              ? t("shopsNow", { price: formatEur(reference.priceCents), store: reference.storeName ?? "" })
              : t("noShops")}
          </p>
          <p className="text-stone">
            {reference.low30Cents !== null
              ? t("low30", { price: formatEur(reference.low30Cents) })
              : t("noLow30")}
          </p>
          {priceCents ? (
            <>
              <p className={claim ? "mt-2 font-semibold text-lime" : "mt-2 text-stone"} data-testid="claim">
                {claim ? t("claim", { saving: formatEur(claim.savingCents) }) : t("noClaim")}
              </p>
              <p data-testid="margin">
                {gain
                  ? t("margin", {
                      amount: formatEur(gain.cents),
                      percent: String(gain.percent).replace(".", ","),
                    })
                  : t("noCost")}
              </p>
              {split ? (
                <p className="text-sm text-stone">
                  {vatRate
                    ? t("vat", {
                        net: formatEur(split.netCents),
                        vat: formatEur(split.vatCents),
                        rate: vatRate,
                      })
                    : t("noVat")}
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1 text-[15px] font-semibold text-mist">{t("condition")}</legend>
          {(["new", "refurbished"] as const).map((c) => (
            <label
              key={c}
              className={`inline-flex min-h-11 cursor-pointer items-center rounded-full px-4 text-[15px] font-semibold ${
                condition === c ? "bg-mist text-night" : "border-[1.5px] border-line-30 text-mist"
              }`}
            >
              <input
                type="radio"
                name="condition"
                value={c}
                checked={condition === c}
                onChange={() => setCondition(c)}
                className="sr-only"
              />
              {t(`condition_${c}`)}
            </label>
          ))}
        </fieldset>
        {condition === "refurbished" ? (
          <label className={labelClass}>
            {t("grade")}
            <input
              name="grade"
              required
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className={inputClass}
            />
          </label>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            {t("warranty")}
            <input
              name="warrantyMonths"
              inputMode="numeric"
              value={warranty}
              onChange={(e) => setWarranty(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            {t("deliveryDays")}
            <input
              name="deliveryWorkingDays"
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            {t("validUntil")}
            <input
              name="validUntil"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            {t("quantity")}
            <input name="quantity" inputMode="numeric" defaultValue="1" className={inputClass} />
          </label>
        </div>

        <label className={labelClass}>
          {t("message")}
          <textarea
            name="message"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={`${inputClass} py-2`}
          />
        </label>

        <details className="rounded-panel-lg border-[1.5px] border-dashed border-line-30 p-4">
          <summary className="min-h-11 cursor-pointer text-[15px] font-semibold text-mist">
            {t("private")}
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            <label className={labelClass}>
              {vatRate ? t("costNet") : t("cost")}
              <input
                name="cost"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              {t("supplier")}
              <input name="supplierNote" className={inputClass} />
            </label>
          </div>
        </details>

        {state.error ? (
          <p role="alert" className="text-[15px] font-semibold text-warning">
            {t.has(`error.${state.error.split(":")[0]}`)
              ? t(`error.${state.error.split(":")[0]}`)
              : state.error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            name="intent"
            value="send"
            size="lg"
            disabled={pending || !priceCents || chosen.size === 0}
          >
            {chosen.size > 1 ? t("sendMany", { count: chosen.size }) : t("send")}
          </Button>
          <Button
            type="submit"
            name="intent"
            value="draft"
            variant="outline"
            disabled={pending || !priceCents || chosen.size === 0}
          >
            {t("draft")}
          </Button>
        </div>
      </div>

      <section aria-label={t("preview")} className="flex flex-col gap-2">
        <h2 className="font-heading text-xl font-semibold text-mist">{t("preview")}</h2>
        {preview ? (
          <EmailPreview
            message={preview}
            labels={{
              to: t("to", { email: preview.to }),
              frame: t("previewFrame"),
              text: t("textVersion"),
            }}
          />
        ) : (
          <p className="text-[15px] text-stone">{t("previewEmpty")}</p>
        )}
      </section>
    </form>
  );
}
