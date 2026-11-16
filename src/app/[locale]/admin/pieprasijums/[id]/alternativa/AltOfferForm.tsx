"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useActionState, useState, useTransition } from "react";
import {
  alternativePriceProblems,
  compareProducts,
  descriptionIssues,
  parseTypedAttributes,
  type AlternativeLabel,
} from "@/domain/offers/alternative";
import { formatEur } from "@/i18n/format";
import { composeOfferEmail } from "@/services/offers/compose";
import type { CompareRow } from "@/services/offers/mail-layout";
import { Button } from "@/ui/Button";
import { alternativeAction, type AltFormState } from "../../../outcome-actions";
import { DescriptionField } from "../../../piedavajumi/DescriptionField";
import { EmailPreview } from "../../../piedavajumi/EmailPreview";
import { OfferPictures, type Picture } from "../../../piedavajumi/OfferPictures";
import { inputClass, labelClass } from "../../../ui";

// The alternative's offer (docs/ALTERNATIVE_OFFER_PLAN.md §3.3–3.4): who gets it
// (directly, or asked first), the price with both hard checks live, pictures and
// "Trilio apraksts", and the e-mail exactly as it goes out, composed by the
// sender's own code. A product no shop lists is typed here.

type Recipient = {
  key: string;
  email: string;
  direct: boolean;
  requestedAt: string | null;
  watchUntil: string | null;
};

type Props = {
  original: { id: string; name: string; subcategoryId: string; attributes: Record<string, unknown> };
  alternative: {
    id: string;
    name: string;
    imageUrl: string | null;
    shopCents: number | null;
    low30Cents: number | null;
  } | null;
  comparison: { label: AlternativeLabel; rows: CompareRow[]; downsides: string[] } | null;
  /** For a product no shop lists: the attributes to type, with their labels. */
  manualKeys: { key: string; label: string }[];
  originalSeenCents: number | null;
  recipients: Recipient[];
  imageSetId: string;
  signature: string;
  inbox: string;
  company: string;
  baseUrl: string;
  defaults: {
    validUntil: string;
    deliveryWorkingDays: number;
    warrantyMonths: number;
    costCents: number | null;
  };
};

type Tone = NonNullable<CompareRow["verdict"]>["tone"];

function cents(raw: string): number | null {
  const v = raw.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

export function AltOfferForm(props: Props) {
  const { original, alternative, recipients, defaults } = props;
  const t = useTranslations("admin.alternative");
  const tv = useTranslations("admin.answers");
  const [state, action, pending] = useActionState<AltFormState, FormData>(alternativeAction, { error: null });
  const [, startSubmit] = useTransition();
  const keepForm = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startSubmit(() => action(data));
  };
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState(
    defaults.costCents ? (defaults.costCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [warranty, setWarranty] = useState(String(defaults.warrantyMonths));
  const [days, setDays] = useState(String(defaults.deliveryWorkingDays));
  const [validUntil, setValidUntil] = useState(defaults.validUntil);
  const [message, setMessage] = useState("");
  const [description, setDescription] = useState("");
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set(recipients.map((r) => r.key)));
  const [manual, setManual] = useState({ name: "", brand: "", model: "", ean: "" });
  const [attrs, setAttrs] = useState<Record<string, string>>({});

  const priceCents = cents(price);
  const problems = priceCents
    ? alternativePriceProblems({
        offerCents: priceCents,
        alternativeShopCents: alternative?.shopCents ?? null,
        originalSeenCents: props.originalSeenCents,
      })
    : [];

  // A product no shop lists: the comparison follows what is typed (numbers as numbers).
  const typed = parseTypedAttributes(Object.entries(attrs));
  const manualComparison = alternative
    ? null
    : compareProducts(
        original.attributes,
        typed,
        props.manualKeys.map((m) => m.key),
        original.subcategoryId,
      );
  const verdictWord = (v: string) => (tv.has(`verdict.${v}`) ? tv(`verdict.${v}` as "verdict.better") : "");
  const comparison =
    props.comparison ??
    (manualComparison
      ? {
          label: manualComparison.label,
          rows: manualComparison.lines.map((l) => ({
            label: props.manualKeys.find((m) => m.key === l.attr)?.label ?? l.attr,
            asked: l.original === null || l.original === undefined ? "—" : String(l.original),
            offered: l.alternative === null || l.alternative === undefined ? "—" : String(l.alternative),
            verdict:
              l.verdict === "same" || l.verdict === "neutral"
                ? null
                : {
                    text: verdictWord(l.verdict),
                    tone: (l.verdict === "better"
                      ? "good"
                      : l.verdict === "unknown"
                        ? "none"
                        : "bad") as Tone,
                  },
          })),
          downsides: manualComparison.lines
            .filter((l) => ["worse", "different", "unknown"].includes(l.verdict))
            .map(
              (l) =>
                `${(props.manualKeys.find((m) => m.key === l.attr)?.label ?? l.attr).toLowerCase()} — ${verdictWord(l.verdict).toLowerCase()}`,
            ),
        }
      : null);
  const descriptionProblems = descriptionIssues(description, comparison?.label ?? null);
  const manualMissing =
    !alternative &&
    (!manual.name.trim() || !manual.brand.trim() || !description.trim() || pictures.length === 0);
  const offeredName = alternative?.name ?? (manual.name.trim() || t("manualTitle"));
  const first = recipients.find((r) => chosen.has(r.key));
  const directCount = recipients.filter((r) => chosen.has(r.key) && r.direct).length;
  const askCount = chosen.size - directCount;

  const preview =
    priceCents && first && comparison
      ? composeOfferEmail(
          {
            token: null,
            productName: offeredName,
            priceCents,
            deliveryWorkingDays: Number(days) || 1,
            referencePriceCents: alternative?.shopCents ?? null,
            referenceLow30Cents: alternative?.low30Cents ?? null,
            condition: "new",
            grade: null,
            warrantyMonths: Number(warranty) || 0,
            message: message.trim() || null,
            validUntil: new Date(`${validUntil}T20:59:59Z`),
            imageUrl: alternative?.imageUrl ?? null,
            imageUrls: pictures.map((p) => p.src),
            description: description.trim() || null,
            alternative: {
              askedName: original.name,
              equivalent: comparison.label === "equivalent",
              rows: comparison.rows,
              downsides: comparison.label === "equivalent" ? [] : comparison.downsides,
              originalSeenCents: props.originalSeenCents,
              requestedAt: first.requestedAt ? new Date(first.requestedAt) : null,
              declineUrl: `${props.baseUrl}/piedavajums/…/atteikt`,
              watchUntil: first.watchUntil ? new Date(first.watchUntil) : null,
            },
          },
          {
            baseUrl: props.baseUrl,
            signature: props.signature,
            inbox: props.inbox,
            company: props.company,
            to: first.email,
            unsubscribeUrl: `${props.baseUrl}/piedavajumi/atteikties/…`,
            saved: null,
            now: new Date(),
          },
        )
      : null;

  const toggle = (key: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const blocked =
    pending ||
    !priceCents ||
    chosen.size === 0 ||
    problems.length > 0 ||
    descriptionProblems.length > 0 ||
    manualMissing;

  return (
    <form
      action={action}
      onSubmit={keepForm}
      className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0"
      data-alt-form
    >
      <input type="hidden" name="originalId" value={original.id} />
      <input type="hidden" name="alternativeId" value={alternative?.id ?? ""} />
      <input type="hidden" name="condition" value="new" />
      <div className="flex flex-col gap-4">
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-[15px] font-semibold text-mist">
            {t("recipients", { count: chosen.size })}
          </legend>
          <ul className="flex flex-col gap-1.5">
            {recipients.map((r) => (
              <li key={r.key}>
                <label className="flex min-h-11 items-center gap-3 text-[15px] text-mist">
                  <input
                    type="checkbox"
                    name="keys"
                    value={r.key}
                    checked={chosen.has(r.key)}
                    onChange={() => toggle(r.key)}
                    className="h-5 w-5 accent-lime"
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {r.email}
                    <span className="block text-sm text-stone">
                      {r.direct ? tv("direct") : tv("askFirst")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="text-sm text-stone" data-alt-split>
            {t("split", { direct: directCount, ask: askCount })}
          </p>
        </fieldset>

        {!alternative ? (
          <fieldset className="flex min-w-0 flex-col gap-3 rounded-panel-lg border-[1.5px] border-line-25 p-4">
            <legend className="px-1 text-[15px] font-semibold text-mist">{t("manualTitle")}</legend>
            <p className="text-sm text-stone">{t("manualRequired")}</p>
            {(
              [
                ["manualName", "name", t("manualName"), true],
                ["manualBrand", "brand", t("manualBrand"), true],
                ["manualModel", "model", t("manualModel"), false],
                ["manualEan", "ean", "EAN", false],
              ] as const
            ).map(([name, key, label, required]) => (
              <label key={name} className={labelClass}>
                {label}
                <input
                  name={name}
                  required={required}
                  value={manual[key]}
                  onChange={(e) => setManual((m) => ({ ...m, [key]: e.target.value }))}
                  className={inputClass}
                />
              </label>
            ))}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {props.manualKeys.map((m) => (
                <label key={m.key} className={labelClass}>
                  {m.label}
                  <input
                    name={`attr_${m.key}`}
                    value={attrs[m.key] ?? ""}
                    onChange={(e) => setAttrs((a) => ({ ...a, [m.key]: e.target.value }))}
                    placeholder={
                      original.attributes[m.key] !== undefined ? String(original.attributes[m.key]) : ""
                    }
                    className={inputClass}
                  />
                </label>
              ))}
            </div>
            <p className="text-sm text-stone">{t("manualNoDiscount")}</p>
          </fieldset>
        ) : null}

        <label className={labelClass}>
          {t("price")}
          <input
            name="price"
            inputMode="decimal"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={props.originalSeenCents ? (props.originalSeenCents / 100).toFixed(0) : "0"}
            className={`${inputClass} font-heading text-2xl`}
          />
        </label>
        <div
          className="rounded-panel-lg border-[1.5px] border-line-25 p-4 text-[15px] text-mist"
          aria-live="polite"
          data-limit-original={props.originalSeenCents ?? ""}
          data-limit-shop={alternative?.shopCents ?? ""}
        >
          <p>
            {t("limitOriginal", {
              price: props.originalSeenCents !== null ? formatEur(props.originalSeenCents) : "—",
            })}
          </p>
          <p>
            {alternative?.shopCents != null
              ? t("limitShop", { price: formatEur(alternative.shopCents) })
              : t("noShopLimit")}
          </p>
          {problems.length ? (
            <ul
              role="alert"
              className="mt-2 font-semibold text-warning"
              data-price-problems={problems.join(",")}
            >
              {problems.map((p) => (
                <li key={p}>{t(`problem.${p}`)}</li>
              ))}
            </ul>
          ) : priceCents ? (
            <p className="mt-2 font-semibold text-lime">{t("priceOk")}</p>
          ) : null}
        </div>

        <OfferPictures
          setId={props.imageSetId}
          defaultAlt={offeredName}
          catalogImage={alternative?.imageUrl ?? null}
          onChange={setPictures}
        />
        <DescriptionField value={description} onChange={setDescription} problems={descriptionProblems} />

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
        </div>
        <label className={labelClass}>
          {t("message")}
          <textarea
            name="message"
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={`${inputClass} py-2`}
          />
        </label>
        <details
          open={!!defaults.costCents}
          className="rounded-panel-lg border-[1.5px] border-dashed border-line-30 p-4"
        >
          <summary className="min-h-11 cursor-pointer text-[15px] font-semibold text-mist">
            {t("private")}
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            <label className={labelClass}>
              {t("cost")}
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
          <p role="alert" className="text-[15px] font-semibold text-warning" data-alt-error={state.error}>
            {t.has(`error.${state.error.split(":")[0]}`)
              ? t(`error.${state.error.split(":")[0]}` as "error.price")
              : state.error}
          </p>
        ) : null}
        <div>
          <Button type="submit" size="lg" disabled={blocked} data-testid="send-alternative">
            {t("send", { direct: directCount, ask: askCount })}
          </Button>
        </div>
      </div>

      <section aria-label={t("preview")} className="flex flex-col gap-2">
        <h2 className="font-heading text-xl font-semibold text-mist">{t("preview")}</h2>
        {first && !first.direct ? <p className="text-sm text-stone">{t("previewAsk")}</p> : null}
        {preview ? (
          <EmailPreview
            message={preview}
            labels={{ to: t("to", { email: preview.to }), frame: t("preview"), text: t("textVersion") }}
          />
        ) : (
          <p className="text-[15px] text-stone">{t("previewEmpty")}</p>
        )}
      </section>
    </form>
  );
}
